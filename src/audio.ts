import { WEAPONS, type WeaponId } from "./weapons";

/**
 * Recorded gunshots per weapon (files in public/sounds/, sources in the README). Several takes per
 * weapon are picked at random so rapid fire does not sound like one looped sample.
 */
const GUNSHOT_SAMPLES: Partial<Record<WeaponId, { files: string[]; volume: number; rate: number }>> = {
  pistol: { files: ["pistol-1", "pistol-2", "pistol-3"], volume: 0.75, rate: 1 },
  shotgun: { files: ["shotgun-1", "shotgun-2"], volume: 0.95, rate: 1 },
  ak47: { files: ["ak47-1", "ak47-2", "ak47-3", "ak47-4"], volume: 0.7, rate: 1 },
  mp40: { files: ["mp40-1", "mp40-2", "mp40-3"], volume: 0.65, rate: 1 },
  m1garand: { files: ["garand-1", "garand-2"], volume: 0.9, rate: 1 },
};

/**
 * The MG 42 and the Gatling fire too fast for single-shot samples: a recorded burst loops while the
 * trigger is held and the tail (last shot and echo) plays when firing stops.
 */
const AUTOFIRE_LOOPS: Partial<Record<WeaponId, { loop: string; tail: string; volume: number; rate: number }>> = {
  // The recording runs at 1200 rounds per minute; played faster to match the game's 1500.
  mg42: { loop: "mg42-loop", tail: "mg42-tail", volume: 0.75, rate: 1.25 },
  gatling: { loop: "gatling-loop", tail: "gatling-tail", volume: 0.7, rate: 1 },
};

const PUMP_SAMPLE = "shotgun-pump";
const FLAK_SHOT_SAMPLE = "flak-shot";
const FLAK_BURST_SAMPLES = ["flak-burst-1", "flak-burst-2"];
const NUKE_SAMPLE = "nuke-blast";
// TODO-MMUEJDE: cut "rpg-launch" from klangfabrik's RPG recording (freesound.org/s/249298) once downloaded.
const ROCKET_LAUNCH_SAMPLE = "rpg-launch";
const BOMB_WHISTLE_SAMPLE = "bomb-whistle";
const GARAND_PING_SAMPLE = "garand-ping";
const SHELL_INSERT_SAMPLES = ["shell-insert-1", "shell-insert-2"];

/** Handling sounds of a reload, placed at fractions of the weapon's reload time. */
const RELOAD_SEQUENCES: Partial<Record<WeaponId, { sample: string; at: number; volume: number; rate: number }[]>> = {
  pistol: [
    { sample: "mag-out", at: 0.08, volume: 0.7, rate: 1 },
    { sample: "mag-in", at: 0.72, volume: 0.8, rate: 1 },
    { sample: "slide-release", at: 0.86, volume: 0.8, rate: 1 },
  ],
  mp40: [
    { sample: "mag-out", at: 0.1, volume: 0.8, rate: 0.85 },
    { sample: "mag-in", at: 0.72, volume: 0.9, rate: 0.85 },
    { sample: "ak47-charge", at: 0.82, volume: 0.8, rate: 1.15 },
  ],
  m1garand: [
    { sample: "garand-clip-in", at: 0.55, volume: 0.9, rate: 1 },
    { sample: "garand-bolt", at: 0.75, volume: 0.9, rate: 1 },
  ],
  ak47: [
    { sample: "mag-out", at: 0.1, volume: 0.8, rate: 0.8 },
    { sample: "mag-in", at: 0.72, volume: 0.9, rate: 0.8 },
    { sample: "ak47-charge", at: 0.82, volume: 0.9, rate: 1 },
  ],
  mg42: [
    { sample: "mg42-cover-open", at: 0.04, volume: 0.9, rate: 0.85 },
    { sample: "mg42-cover-close", at: 0.84, volume: 0.9, rate: 0.85 },
  ],
  rpg7: [{ sample: "rpg-load", at: 0, volume: 0.9, rate: 1 }],
};
const SPEED_OF_SOUND = 343;
const CASING_SAMPLES = ["casing-1", "casing-2", "casing-3", "casing-4", "casing-5", "casing-6"];
const SHELL_DROP_SAMPLES = ["shell-drop-1", "shell-drop-2"];
/** Time an ejected case needs to fall from the weapon to the ground. */
const CASING_FALL_S = 0.55;
/** Under automatic fire not every case gets its own clink, or they turn into noise. */
const CASING_MIN_GAP_S = 0.09;
/** The recorded pump stroke is a little slower than the animated one. */
const PUMP_RATE = 1.1;

/** Sound effects: recorded gunshots plus effects synthesized with the Web Audio API. */
export class Sfx {
  private context: AudioContext | null = null;
  /** Gunshots run through a compressor so overlapping automatic fire does not clip. */
  private gunBus: DynamicsCompressorNode | null = null;
  private readonly sampleFiles = new Map<string, Promise<ArrayBuffer>>();
  private readonly samples = new Map<string, AudioBuffer>();
  private lastCasing = 0;
  private reloadSounds: AudioBufferSourceNode[] = [];
  private autoFire: { weapon: WeaponId; source: AudioBufferSourceNode; gain: GainNode; timer: number } | null = null;
  private noise: AudioBuffer | null = null;
  private laser: { oscillators: OscillatorNode[]; gain: GainNode } | null = null;
  private weather: { kind: "rain" | "wind"; source: AudioBufferSourceNode; gain: GainNode } | null = null;

  constructor() {
    // Fetch the recordings right away; decoding needs the AudioContext, which only exists after unlock().
    const names = new Set([
      ...Object.values(GUNSHOT_SAMPLES).flatMap((sample) => sample.files),
      ...Object.values(AUTOFIRE_LOOPS).flatMap((sample) => [sample.loop, sample.tail]),
      PUMP_SAMPLE,
      FLAK_SHOT_SAMPLE,
      ...FLAK_BURST_SAMPLES,
      NUKE_SAMPLE,
      ...CASING_SAMPLES,
      ...SHELL_DROP_SAMPLES,
      ...SHELL_INSERT_SAMPLES,
      ...Object.values(RELOAD_SEQUENCES).flatMap((steps) => steps.map((step) => step.sample)),
      BOMB_WHISTLE_SAMPLE,
      GARAND_PING_SAMPLE,
    ]);
    for (const name of names) {
      const file = fetch(`${import.meta.env.BASE_URL}sounds/${name}.wav`).then((response) => {
        if (!response.ok) throw new Error(`Missing sound ${name}.wav`);
        return response.arrayBuffer();
      });
      file.catch(() => undefined);
      this.sampleFiles.set(name, file);
    }
  }

  /** Browsers only allow audio after a user gesture, so this is called from the start button. */
  unlock(): void {
    if (!this.context) {
      this.context = new AudioContext();
      const length = this.context.sampleRate * 2;
      this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.gunBus = this.context.createDynamicsCompressor();
      this.gunBus.threshold.value = -10;
      this.gunBus.ratio.value = 6;
      this.gunBus.connect(this.context.destination);
      this.decodeSamples(this.context);
    }
    void this.context.resume();
  }

  /** Recorded shot of the weapon; falls back to a synthesized one while the files are still loading. */
  gunshot(weapon: WeaponId): void {
    const ctx = this.context;
    const loop = AUTOFIRE_LOOPS[weapon];
    if (ctx && loop && this.samples.has(loop.loop)) {
      this.continueAutoFire(ctx, weapon, loop);
      return;
    }
    const config = GUNSHOT_SAMPLES[weapon];
    const name = config?.files[Math.floor(Math.random() * config.files.length)];
    const buffer = name ? this.samples.get(name) : undefined;
    if (!ctx || !this.gunBus || !config || !name || !buffer) {
      if (weapon === "shotgun" || weapon === "pistol") this.shot();
      else this.mgShot();
      return;
    }
    this.playSample(name, config.volume * (0.9 + Math.random() * 0.1), config.rate * (0.96 + Math.random() * 0.08));
  }

  /** An ejected case (or shotgun shell) hits the ground and bounces. */
  casingDrop(kind: "brass" | "shell"): void {
    const ctx = this.context;
    if (!ctx) return;
    const landsAt = ctx.currentTime + CASING_FALL_S + Math.random() * 0.15;
    if (landsAt - this.lastCasing < CASING_MIN_GAP_S) return;
    this.lastCasing = landsAt;
    const names = kind === "shell" ? SHELL_DROP_SAMPLES : CASING_SAMPLES;
    const name = names[Math.floor(Math.random() * names.length)];
    if (name) this.playSample(name, 0.3, 0.92 + Math.random() * 0.16, { delay: landsAt - ctx.currentTime });
  }

  /** Starts the burst loop on the first shot and keeps it running as long as shots keep coming. */
  private continueAutoFire(
    ctx: AudioContext,
    weapon: WeaponId,
    config: { loop: string; tail: string; volume: number; rate: number },
  ): void {
    if (this.autoFire?.weapon !== weapon) {
      this.stopAutoFire();
      const buffer = this.samples.get(config.loop);
      if (!buffer || !this.gunBus) return;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = config.rate;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(config.volume, ctx.currentTime + 0.005);
      source.connect(gain).connect(this.gunBus);
      source.start();
      this.autoFire = { weapon, source, gain, timer: 0 };
    }
    // Stop once no shot followed for two fire intervals (trigger released, belt empty, weapon switched).
    window.clearTimeout(this.autoFire.timer);
    const hold = Math.max(0.15, WEAPONS[weapon].fireInterval * 2);
    this.autoFire.timer = window.setTimeout(() => this.stopAutoFire(), hold * 1000);
  }

  private stopAutoFire(): void {
    const ctx = this.context;
    const fire = this.autoFire;
    if (!ctx || !fire) return;
    this.autoFire = null;
    window.clearTimeout(fire.timer);
    const now = ctx.currentTime;
    fire.gain.gain.setValueAtTime(fire.gain.gain.value, now);
    fire.gain.gain.linearRampToValueAtTime(0, now + 0.03);
    fire.source.stop(now + 0.04);
    const config = AUTOFIRE_LOOPS[fire.weapon];
    if (config) this.playSample(config.tail, config.volume, 1);
  }

  /** Plays a recording; `delay` and `lowpass` make distant sounds arrive later and duller. */
  private playSample(
    name: string,
    volume: number,
    rate: number,
    options: { delay?: number; lowpass?: number } = {},
  ): AudioBufferSourceNode | null {
    const ctx = this.context;
    const buffer = this.samples.get(name);
    if (!ctx || !this.gunBus || !buffer) return null;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = volume;
    let output: AudioNode = source;
    if (options.lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = options.lowpass;
      output = output.connect(filter);
    }
    output.connect(gain).connect(this.gunBus);
    source.start(ctx.currentTime + (options.delay ?? 0));
    return source;
  }

  private decodeSamples(ctx: AudioContext): void {
    for (const [name, file] of this.sampleFiles) {
      file
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => this.samples.set(name, buffer))
        .catch((error: unknown) => console.warn(`Sound ${name} not available`, error));
    }
  }

  shot(): void {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.noiseBurst(now, 0.4, 0.9, "lowpass", 2400, 300);

    this.tone(now, "sine", 140, 40, 0.25, 0.8);
  }

  mgShot(): void {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.noiseBurst(now, 0.13, 0.6, "lowpass", 3200, 500);
    this.tone(now, "sine", 170, 55, 0.09, 0.45);
  }

  flakShot(): void {
    const ctx = this.context;
    if (!ctx || this.playSample(FLAK_SHOT_SAMPLE, 1, 0.9)) return;
    const now = ctx.currentTime;
    this.noiseBurst(now, 1.4, 1, "lowpass", 1800, 120);
    this.tone(now, "sine", 90, 28, 0.6, 1);
  }

  /** Distant crack of a flak shell: quieter, duller and later the further away it bursts. */
  flakBurst(distance: number): void {
    const ctx = this.context;
    if (!ctx) return;
    const volume = Math.max(0.15, Math.min(0.8, 40 / distance));
    const name = FLAK_BURST_SAMPLES[Math.floor(Math.random() * FLAK_BURST_SAMPLES.length)];
    const lowpass = Math.max(900, 12000 - distance * 60);
    if (name && this.playSample(name, volume, 0.95 + Math.random() * 0.1, { delay: distance / SPEED_OF_SOUND, lowpass })) return;
    this.noiseBurst(ctx.currentTime, 0.7, volume, "lowpass", 1200, 150);
  }

  flakLoad(): void {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.noiseBurst(now, 0.12, 0.5, "bandpass", 700, 500);
    this.tone(now, "square", 220, 140, 0.08, 0.12);
  }

  laserStart(): void {
    const ctx = this.context;
    if (!ctx || this.laser) return;
    const hum = ctx.createOscillator();
    const wobble = ctx.createOscillator();
    const wobbleDepth = ctx.createGain();
    const gain = ctx.createGain();
    hum.type = "sawtooth";
    hum.frequency.value = 220;
    wobble.frequency.value = 18;
    wobbleDepth.gain.value = 30;
    wobble.connect(wobbleDepth).connect(hum.frequency);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.05);
    hum.connect(gain).connect(ctx.destination);
    hum.start();
    wobble.start();
    this.laser = { oscillators: [hum, wobble], gain };
  }

  laserStop(): void {
    const ctx = this.context;
    if (!ctx || !this.laser) return;
    const { oscillators, gain } = this.laser;
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
    for (const oscillator of oscillators) oscillator.stop(ctx.currentTime + 0.1);
    this.laser = null;
  }

  sizzle(): void {
    const ctx = this.context;
    if (!ctx) return;
    this.noiseBurst(ctx.currentTime, 0.5, 0.35, "highpass", 4000, 2500);
  }

  /** The famous "ping" of the Garand's empty clip flying out. */
  garandPing(): void {
    const ctx = this.context;
    if (!ctx || this.playSample(GARAND_PING_SAMPLE, 0.7, 1)) return;
    const now = ctx.currentTime;
    this.tone(now + 0.02, "triangle", 3100, 2950, 0.5, 0.25);
    this.tone(now + 0.02, "sine", 4650, 4500, 0.35, 0.08);
  }

  /** Two short beeps and static: the strike is confirmed over the radio. */
  radioCall(): void {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.noiseBurst(now, 0.25, 0.15, "bandpass", 2500, 2500);
    for (const at of [0.05, 0.22]) this.tone(now + at, "square", 1200, 1200, 0.1, 0.12);
  }

  /** Falling whistle that ends when the bomb hits the ground. */
  bombWhistle(duration: number): void {
    const ctx = this.context;
    if (!ctx) return;
    const buffer = this.samples.get(BOMB_WHISTLE_SAMPLE);
    if (buffer) {
      // Line the end of the recording up with the impact.
      this.playSample(BOMB_WHISTLE_SAMPLE, 0.9, 1, { delay: Math.max(0, duration - buffer.duration) });
      return;
    }
    const now = ctx.currentTime;
    const whistle = ctx.createOscillator();
    const gain = ctx.createGain();
    whistle.type = "sine";
    whistle.frequency.setValueAtTime(1900, now);
    whistle.frequency.exponentialRampToValueAtTime(500, now + duration);
    gain.gain.setValueAtTime(0.02, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + duration * 0.9);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    whistle.connect(gain).connect(ctx.destination);
    whistle.start(now);
    whistle.stop(now + duration);
  }

  rocketLaunch(): void {
    const ctx = this.context;
    if (!ctx || this.playSample(ROCKET_LAUNCH_SAMPLE, 1, 1)) return;
    const now = ctx.currentTime;
    this.noiseBurst(now, 0.5, 1, "lowpass", 3000, 400);
    this.noiseBurst(now + 0.05, 1.2, 0.5, "bandpass", 1800, 600);
  }

  /** Plays the recorded handling sounds of a reload, spread over its `duration`. */
  reload(weapon: WeaponId, duration: number): void {
    this.cancelReload();
    const steps = RELOAD_SEQUENCES[weapon];
    if (!steps) return;
    for (const step of steps) {
      const source = this.playSample(step.sample, step.volume, step.rate, { delay: step.at * duration });
      if (source) this.reloadSounds.push(source);
    }
    if (this.reloadSounds.length === 0) this.coverOpen();
  }

  /** Stops the pending handling sounds when a reload is interrupted, e.g. by switching weapons. */
  cancelReload(): void {
    for (const source of this.reloadSounds) source.stop();
    this.reloadSounds = [];
  }

  nukeBlast(): void {
    const ctx = this.context;
    if (!ctx || this.playSample(NUKE_SAMPLE, 1, 0.85)) return;
    const now = ctx.currentTime;
    this.noiseBurst(now, 6, 1, "lowpass", 2500, 60);
    this.tone(now, "sine", 60, 20, 4, 1);
    this.noiseBurst(now + 1.5, 4, 0.6, "lowpass", 400, 50);
  }

  geigerTick(): void {
    const ctx = this.context;
    if (!ctx) return;
    this.noiseBurst(ctx.currentTime, 0.008, 0.25, "highpass", 5000, 5000);
  }

  /** Hit on armour or on the boss without killing it. */
  clang(): void {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.tone(now, "square", 1800, 1200, 0.12, 0.12);
    this.tone(now, "triangle", 2600, 2400, 0.25, 0.1);
  }

  /** Golden chicken. */
  chime(): void {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    [880, 1175, 1568].forEach((frequency, index) => this.tone(now + index * 0.07, "sine", frequency, frequency, 0.35, 0.2));
  }

  bossCall(): void {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.tone(now, "sawtooth", 220, 160, 0.5, 0.25);
    this.tone(now + 0.45, "sawtooth", 260, 120, 0.8, 0.25);
  }

  moo(): void {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.tone(now, "sawtooth", 140, 95, 1.1, 0.22);
    this.tone(now, "square", 70, 50, 1.1, 0.08);
  }

  creak(): void {
    const ctx = this.context;
    if (!ctx) return;
    this.tone(ctx.currentTime, "sawtooth", 320, 180, 0.7, 0.08);
  }

  whoosh(): void {
    const ctx = this.context;
    if (!ctx) return;
    this.noiseBurst(ctx.currentTime, 0.6, 0.35, "bandpass", 400, 2500);
  }

  cricket(): void {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (let i = 0; i < 3; i++) this.tone(now + i * 0.06, "sine", 4400, 4300, 0.035, 0.04);
  }

  /** Looping background sound for the weather; null stops it. */
  setWeatherSound(kind: "rain" | "wind" | null): void {
    const ctx = this.context;
    if (!ctx || !this.noise) return;
    if (this.weather?.kind === kind) return;
    if (this.weather) {
      this.weather.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      this.weather.source.stop(ctx.currentTime + 1.5);
      this.weather = null;
    }
    if (!kind) return;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = this.noise;
    source.loop = true;
    filter.type = kind === "rain" ? "bandpass" : "lowpass";
    filter.frequency.value = kind === "rain" ? 1400 : 380;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.setTargetAtTime(kind === "rain" ? 0.12 : 0.18, ctx.currentTime, 0.8);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
    this.weather = { kind, source, gain };
  }

  /** Pump stroke: back and forward. */
  pump(): void {
    const ctx = this.context;
    if (!ctx || this.playSample(PUMP_SAMPLE, 0.8, PUMP_RATE)) return;
    const now = ctx.currentTime;
    this.noiseBurst(now, 0.06, 0.5, "bandpass", 2200, 1800);
    this.noiseBurst(now + 0.16, 0.08, 0.6, "bandpass", 1600, 1200);
  }

  shellInsert(): void {
    const ctx = this.context;
    const name = SHELL_INSERT_SAMPLES[Math.floor(Math.random() * SHELL_INSERT_SAMPLES.length)];
    if (!ctx || (name && this.playSample(name, 0.45, 0.95 + Math.random() * 0.1))) return;
    this.noiseBurst(ctx.currentTime, 0.04, 0.35, "bandpass", 1900, 1500);
  }

  coverOpen(): void {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.noiseBurst(now, 0.07, 0.45, "bandpass", 1300, 900);
    this.tone(now, "square", 420, 300, 0.05, 0.08);
  }

  switchWeapon(): void {
    const ctx = this.context;
    if (!ctx) return;
    this.noiseBurst(ctx.currentTime, 0.18, 0.25, "lowpass", 900, 300);
  }

  empty(): void {
    const ctx = this.context;
    if (!ctx) return;
    this.noiseBurst(ctx.currentTime, 0.03, 0.4, "highpass", 3000, 3000);
  }

  squawk(): void {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    const start = 900 + Math.random() * 400;
    for (const [offset, from] of [[0, start], [0.13, start * 0.8]] as const) {
      const voice = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      voice.type = "sawtooth";
      voice.frequency.setValueAtTime(from, now + offset);
      voice.frequency.exponentialRampToValueAtTime(from * 0.6, now + offset + 0.12);
      filter.type = "bandpass";
      filter.frequency.value = 1400;
      filter.Q.value = 2;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.12);
      voice.connect(filter).connect(gain).connect(ctx.destination);
      voice.start(now + offset);
      voice.stop(now + offset + 0.13);
    }
  }

  timeUp(): void {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    [660, 550, 440].forEach((frequency, index) => {
      const tone = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = now + index * 0.18;
      tone.type = "triangle";
      tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0.25, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
      tone.connect(gain).connect(ctx.destination);
      tone.start(at);
      tone.stop(at + 0.3);
    });
  }

  private tone(at: number, type: OscillatorType, from: number, to: number, duration: number, volume: number): void {
    const ctx = this.context;
    if (!ctx) return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, at);
    oscillator.frequency.exponentialRampToValueAtTime(to, at + duration);
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(at);
    oscillator.stop(at + duration);
  }

  private noiseBurst(
    at: number,
    duration: number,
    volume: number,
    filterType: BiquadFilterType,
    fromFrequency: number,
    toFrequency: number,
  ): void {
    const ctx = this.context;
    if (!ctx || !this.noise) return;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = this.noise;
    source.loop = true;
    filter.type = filterType;
    filter.frequency.setValueAtTime(fromFrequency, at);
    filter.frequency.exponentialRampToValueAtTime(toFrequency, at + duration);
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(at, Math.random() * 0.5);
    source.stop(at + duration);
  }
}

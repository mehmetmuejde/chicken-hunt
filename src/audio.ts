/** Sound effects synthesized with the Web Audio API, so the game ships without audio files. */
export class Sfx {
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private laser: { oscillators: OscillatorNode[]; gain: GainNode } | null = null;

  /** Browsers only allow audio after a user gesture, so this is called from the start button. */
  unlock(): void {
    if (!this.context) {
      this.context = new AudioContext();
      const length = this.context.sampleRate * 2;
      this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    void this.context.resume();
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
    if (!ctx) return;
    const now = ctx.currentTime;
    this.noiseBurst(now, 1.4, 1, "lowpass", 1800, 120);
    this.tone(now, "sine", 90, 28, 0.6, 1);
  }

  /** Distant crack of a flak shell; quieter the further away it bursts. */
  flakBurst(distance: number): void {
    const ctx = this.context;
    if (!ctx) return;
    const volume = Math.max(0.15, Math.min(0.8, 40 / distance));
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

  nukeThrow(): void {
    const ctx = this.context;
    if (!ctx) return;
    this.noiseBurst(ctx.currentTime, 0.5, 0.3, "bandpass", 600, 2000);
  }

  nukeBlast(): void {
    const ctx = this.context;
    if (!ctx) return;
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

  /** Pump stroke: back and forward. */
  pump(): void {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.noiseBurst(now, 0.06, 0.5, "bandpass", 2200, 1800);
    this.noiseBurst(now + 0.16, 0.08, 0.6, "bandpass", 1600, 1200);
  }

  shellInsert(): void {
    const ctx = this.context;
    if (!ctx) return;
    this.noiseBurst(ctx.currentTime, 0.04, 0.35, "bandpass", 1900, 1500);
  }

  coverOpen(): void {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.noiseBurst(now, 0.07, 0.45, "bandpass", 1300, 900);
    this.tone(now, "square", 420, 300, 0.05, 0.08);
  }

  coverClose(): void {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.noiseBurst(now, 0.09, 0.6, "bandpass", 1000, 700);
    this.tone(now, "square", 300, 180, 0.06, 0.1);
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

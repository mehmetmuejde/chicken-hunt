import { TIMES_OF_DAY, WEATHERS } from "./atmosphere";
import { SCENERIES, SCENERY_IDS } from "./scenery";
import { type AtmosphereChoice, BIRD_COUNT, type SceneryChoice } from "./storage";
import type { AmmoStatus } from "./weapon-controller";
import { keyLabel, WEAPON_KEYS, WEAPON_ORDER, WEAPONS, type WeaponId } from "./weapons";

const POPUP_LIFETIME_MS = 900;
const BANNER_LIFETIME_MS = 2200;

export type PopupTone = "score" | "bonus" | "penalty" | "info";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

/** DOM overlay: score, timer, ammo, crosshair and the start/end screens. */
export class Hud {
  private readonly hud = byId("hud");
  private readonly score = byId("score");
  private readonly time = byId("time");
  private readonly ammo = byId("ammo");
  private readonly ammoCount = byId("ammo-count");
  private readonly ammoBar = byId("ammo-bar");
  private readonly weapons = byId("weapons");
  private readonly reloadHint = byId("reload-hint");
  private readonly crosshair = byId("crosshair");
  private readonly flash = byId("flash");
  private readonly popups = byId("popups");
  private readonly startScreen = byId("start-screen");
  private readonly endScreen = byId("end-screen");
  private readonly startBest = byId("start-best");
  private readonly finalScore = byId("final-score");
  private readonly endBest = byId("end-best");
  private readonly newBest = byId("new-best");
  private readonly nukeFlashOverlay = byId("nuke-flash");
  private readonly cracks = byId<HTMLCanvasElement>("cracks");
  private readonly birdSliders = [byId<HTMLInputElement>("bird-count-start"), byId<HTMLInputElement>("bird-count-end")];
  private readonly birdLabels = [byId("bird-count-start-value"), byId("bird-count-end-value")];
  private readonly combo = byId("combo");
  private readonly comboValue = byId("combo-value");
  private readonly comboFill = byId("combo-fill");
  private readonly bossBar = byId("boss-bar");
  private readonly bossFill = byId("boss-fill");
  private readonly banner = byId("banner");
  private readonly timeSelects = [byId<HTMLSelectElement>("time-start"), byId<HTMLSelectElement>("time-end")];
  private readonly weatherSelects = [byId<HTMLSelectElement>("weather-start"), byId<HTMLSelectElement>("weather-end")];
  private readonly scenerySelects = [byId<HTMLSelectElement>("scenery-start"), byId<HTMLSelectElement>("scenery-end")];
  private lastAmmo = "";
  private bannerTimer = 0;
  readonly startButton = byId<HTMLButtonElement>("start-button");
  readonly restartButton = byId<HTMLButtonElement>("restart-button");

  showStart(best: number): void {
    this.startBest.textContent = String(best);
    this.startScreen.hidden = false;
    this.endScreen.hidden = true;
    this.hud.hidden = true;
    document.body.classList.remove("is-playing");
    this.startButton.focus();
  }

  showPlaying(): void {
    this.startScreen.hidden = true;
    this.endScreen.hidden = true;
    this.hud.hidden = false;
    document.body.classList.add("is-playing");
  }

  showEnd(score: number, best: number, isNewBest: boolean): void {
    this.finalScore.textContent = String(score);
    this.endBest.textContent = String(best);
    this.newBest.hidden = !isNewBest;
    this.endScreen.hidden = false;
    this.hud.hidden = true;
    this.combo.hidden = true;
    this.bossBar.hidden = true;
    document.body.classList.remove("is-playing");
    this.restartButton.focus();
  }

  setScore(score: number): void {
    this.score.textContent = String(score);
  }

  setTime(seconds: number): void {
    const whole = Math.max(0, Math.ceil(seconds));
    this.time.textContent = String(whole);
    this.time.classList.toggle("is-low", whole <= 10);
  }

  setLoading(loading: boolean): void {
    this.startButton.disabled = loading;
    this.startButton.textContent = loading ? "Loading weapons…" : "Start hunting";
  }

  setWeapon(active: WeaponId): void {
    if (this.weapons.childElementCount === 0) {
      this.weapons.replaceChildren(
        ...WEAPON_ORDER.map((id, index) => {
          const item = document.createElement("span");
          item.className = "weapon";
          item.dataset.weapon = id;
          item.innerHTML = `<kbd>${keyLabel(WEAPON_KEYS[index] ?? "")}</kbd> ${WEAPONS[id].name}`;
          return item;
        }),
      );
    }
    for (const item of Array.from(this.weapons.children)) {
      if (item instanceof HTMLElement) item.classList.toggle("is-active", item.dataset.weapon === active);
    }
  }

  /** Wires both bird-count sliders (start and end screen) to one value. */
  bindBirdCount(initial: number, onChange: (count: number) => void): void {
    const apply = (count: number): void => {
      for (const slider of this.birdSliders) slider.value = String(count);
      for (const label of this.birdLabels) label.textContent = String(count);
    };
    for (const slider of this.birdSliders) {
      slider.min = String(BIRD_COUNT.min);
      slider.max = String(BIRD_COUNT.max);
      slider.addEventListener("input", () => {
        const count = Number(slider.value);
        apply(count);
        onChange(count);
      });
    }
    apply(initial);
  }

  /** Wires the time-of-day and weather selects on both screens to one choice. */
  bindAtmosphere(initial: AtmosphereChoice, onChange: (choice: AtmosphereChoice) => void): void {
    const label = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
    const fill = (select: HTMLSelectElement, values: readonly string[]): void => {
      select.replaceChildren(
        ...["random", ...values].map((value) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label(value);
          return option;
        }),
      );
    };
    const read = (select: HTMLSelectElement): AtmosphereChoice => {
      const isTime = this.timeSelects.includes(select);
      const time = (isTime ? select.value : this.timeSelects[0]?.value) as AtmosphereChoice["time"];
      const weather = (isTime ? this.weatherSelects[0]?.value : select.value) as AtmosphereChoice["weather"];
      return { time, weather };
    };
    const apply = (choice: AtmosphereChoice): void => {
      for (const select of this.timeSelects) select.value = choice.time;
      for (const select of this.weatherSelects) select.value = choice.weather;
    };
    for (const select of this.timeSelects) fill(select, TIMES_OF_DAY);
    for (const select of this.weatherSelects) fill(select, WEATHERS);
    for (const select of [...this.timeSelects, ...this.weatherSelects]) {
      select.addEventListener("change", () => {
        const choice = read(select);
        apply(choice);
        onChange(choice);
      });
    }
    apply(initial);
  }

  /** Scene select on the start and end screen; both stay in sync. */
  bindScenery(initial: SceneryChoice, onChange: (choice: SceneryChoice) => void): void {
    for (const select of this.scenerySelects) {
      select.replaceChildren(
        ...(["random", ...SCENERY_IDS] as const).map((value) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value === "random" ? "Random" : SCENERIES[value].name;
          return option;
        }),
      );
      select.value = initial;
      select.addEventListener("change", () => {
        const choice = select.value as SceneryChoice;
        for (const other of this.scenerySelects) other.value = choice;
        onChange(choice);
      });
    }
  }

  setCombo(multiplier: number, remaining: number): void {
    this.combo.hidden = multiplier <= 1;
    if (multiplier <= 1) return;
    this.comboValue.textContent = `×${multiplier}`;
    this.comboFill.style.setProperty("--fill", String(remaining));
  }

  /** Health bar floating above the boss; `at` null hides it. */
  setBossBar(at: { x: number; y: number } | null, fraction: number): void {
    this.bossBar.hidden = at === null;
    if (!at) return;
    this.bossBar.style.transform = `translate(${at.x}px, ${at.y}px)`;
    this.bossFill.style.setProperty("--fill", String(fraction));
  }

  /** Big announcement in the middle of the screen. */
  showBanner(text: string): void {
    this.banner.textContent = text;
    this.banner.classList.remove("is-active");
    void this.banner.offsetWidth; // restart the CSS animation
    this.banner.classList.add("is-active");
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove("is-active"), BANNER_LIFETIME_MS);
  }

  setAmmo(status: AmmoStatus): void {
    // Called every frame: only touch the DOM when something changed.
    const key = JSON.stringify(status);
    if (key === this.lastAmmo) return;
    this.lastAmmo = key;

    this.ammo.hidden = status.kind !== "shells";
    this.ammoCount.hidden = status.kind === "shells";
    this.ammoBar.hidden = status.kind === "shells";

    switch (status.kind) {
      case "shells":
        if (this.ammo.childElementCount !== status.capacity) {
          this.ammo.replaceChildren(
            ...Array.from({ length: status.capacity }, () => {
              const shell = document.createElement("span");
              shell.className = "shell";
              return shell;
            }),
          );
        }
        Array.from(this.ammo.children).forEach((shell, index) => {
          shell.classList.toggle("is-spent", index >= status.count);
        });
        break;
      case "counter":
        this.ammoCount.textContent = `${status.count} / ${status.capacity}`;
        this.ammoBar.style.setProperty("--fill", String(status.count / status.capacity));
        break;
      case "gauge":
        this.ammoCount.textContent = status.label;
        this.ammoBar.style.setProperty("--fill", String(status.fill));
        break;
    }

    this.reloadHint.textContent = status.hint;
    this.reloadHint.classList.toggle("is-urgent", status.urgent);
  }

  /** Blinding white flash of the atomic bomb. */
  /** Draws a shattered pane over the view, as if the shock wave cracked the glass in front of the player. */
  crackScreen(): void {
    const canvas = this.cracks;
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * scale);
    canvas.height = Math.round(window.innerHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const reach = Math.hypot(width, height);
    const impact = { x: width * (0.3 + Math.random() * 0.4), y: height * (0.3 + Math.random() * 0.4) };

    // Radial cracks: jagged lines from the impact point to the edge, some of them branching.
    const lines: { x: number; y: number }[][] = [];
    const spokes: { x: number; y: number }[][] = [];
    const count = 14 + Math.floor(Math.random() * 6);
    for (let i = 0; i < count; i++) {
      let angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const spoke = [{ ...impact }];
      let point = { ...impact };
      while (Math.hypot(point.x - impact.x, point.y - impact.y) < reach) {
        angle += (Math.random() - 0.5) * 0.35;
        const step = 18 + Math.random() * 28;
        point = { x: point.x + Math.cos(angle) * step, y: point.y + Math.sin(angle) * step };
        spoke.push(point);
        if (Math.random() < 0.08) {
          let branchAngle = angle + (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.5);
          const branch = [point];
          let tip = point;
          for (let j = 0; j < 3 + Math.random() * 6; j++) {
            branchAngle += (Math.random() - 0.5) * 0.4;
            tip = { x: tip.x + Math.cos(branchAngle) * 22, y: tip.y + Math.sin(branchAngle) * 22 };
            branch.push(tip);
          }
          lines.push(branch);
        }
      }
      spokes.push(spoke);
      lines.push(spoke);
    }

    // Concentric rings join neighbouring spokes, which gives the spider-web look.
    for (const radius of [40 + Math.random() * 30, 120 + Math.random() * 60, 260 + Math.random() * 120]) {
      for (let i = 0; i < spokes.length; i++) {
        if (Math.random() < 0.25) continue;
        const a = spokes[i]?.find((p) => Math.hypot(p.x - impact.x, p.y - impact.y) >= radius);
        const b = spokes[(i + 1) % spokes.length]?.find((p) => Math.hypot(p.x - impact.x, p.y - impact.y) >= radius);
        if (!a || !b) continue;
        const middle = {
          x: (a.x + b.x) / 2 + (Math.random() - 0.5) * 12,
          y: (a.y + b.y) / 2 + (Math.random() - 0.5) * 12,
        };
        lines.push([a, middle, b]);
      }
    }

    ctx.clearRect(0, 0, width, height);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const stroke = (style: string, lineWidth: number, offset: number): void => {
      ctx.strokeStyle = style;
      ctx.lineWidth = lineWidth;
      for (const line of lines) {
        ctx.beginPath();
        line.forEach((p, index) => (index === 0 ? ctx.moveTo(p.x + offset, p.y + offset) : ctx.lineTo(p.x + offset, p.y + offset)));
        ctx.stroke();
      }
    };
    stroke("rgb(0 0 0 / 0.35)", 2.6, 1);
    stroke("rgb(255 255 255 / 0.7)", 1.2, 0);
    // Crushed glass around the point of impact.
    const crush = ctx.createRadialGradient(impact.x, impact.y, 0, impact.x, impact.y, 46);
    crush.addColorStop(0, "rgb(255 255 255 / 0.55)");
    crush.addColorStop(1, "rgb(255 255 255 / 0)");
    ctx.fillStyle = crush;
    ctx.beginPath();
    ctx.arc(impact.x, impact.y, 46, 0, Math.PI * 2);
    ctx.fill();
  }

  clearCracks(): void {
    this.cracks.getContext("2d")?.clearRect(0, 0, this.cracks.width, this.cracks.height);
  }

  nukeFlash(): void {
    this.nukeFlashOverlay.classList.remove("is-active");
    void this.nukeFlashOverlay.offsetWidth; // restart the CSS animation
    this.nukeFlashOverlay.classList.add("is-active");
  }

  moveCrosshair(x: number, y: number): void {
    this.crosshair.style.transform = `translate(${x}px, ${y}px)`;
  }

  shotFlash(x: number, y: number): void {
    this.flash.style.setProperty("--x", `${x}px`);
    this.flash.style.setProperty("--y", `${y}px`);
    this.flash.classList.remove("is-active");
    void this.flash.offsetWidth; // restart the CSS animation
    this.flash.classList.add("is-active");
  }

  popup(text: string, x: number, y: number, tone: PopupTone = "score"): void {
    const popup = document.createElement("div");
    popup.className = `popup popup--${tone}`;
    popup.textContent = text;
    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;
    this.popups.append(popup);
    window.setTimeout(() => popup.remove(), POPUP_LIFETIME_MS);
  }
}

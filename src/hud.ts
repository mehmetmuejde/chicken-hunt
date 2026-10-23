import { BIRD_COUNT } from "./storage";
import type { AmmoStatus } from "./weapon-controller";
import { WEAPON_ORDER, WEAPONS, type WeaponId } from "./weapons";

const POPUP_LIFETIME_MS = 900;

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
  private readonly birdSliders = [byId<HTMLInputElement>("bird-count-start"), byId<HTMLInputElement>("bird-count-end")];
  private readonly birdLabels = [byId("bird-count-start-value"), byId("bird-count-end-value")];
  private lastAmmo = "";
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
          item.innerHTML = `<kbd>${index + 1}</kbd> ${WEAPONS[id].name}`;
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

  popup(text: string, x: number, y: number): void {
    const popup = document.createElement("div");
    popup.className = "popup";
    popup.textContent = text;
    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;
    this.popups.append(popup);
    window.setTimeout(() => popup.remove(), POPUP_LIFETIME_MS);
  }
}

import "./style.css";
import { Engine } from "./babylon";
import { Sfx } from "./audio";
import { Game } from "./game";
import { Hud } from "./hud";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) throw new Error("Missing #game canvas");

const engine = new Engine(canvas, true, { stencil: false }, true);
const game = new Game(engine, canvas, new Hud(), new Sfx());

engine.runRenderLoop(() => game.render());
window.addEventListener("resize", () => engine.resize());

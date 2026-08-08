/**
 * main.js — Entry point: boots the PS1 arcade racer on the Froyo engine.
 *
 * Mounts a fullscreen 640x480 canvas (the 320x240 internal render is upscaled
 * 2x + dithered onto it) and starts RacerGame. The touch overlay provides
 * mobile controls (joystick = steer/throttle, A = gas, X = drift, START = pause).
 */
import { RacerGame } from "./racer/racergame.js";
import { runIntro } from "./racer/intro.js";
import { audio } from "./engine/sdk-audio.js";
import { createTouchOverlay } from "./engine/touch.js";

document.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("game-root");
  if (!root) return;

  root.innerHTML = `
    <div id="froyo-shell" style="
      position: fixed; inset: 0;
      background: #000;
      display: flex; align-items: center; justify-content: center;
    ">
      <canvas id="froyo-canvas" width="640" height="480" style="
        position: absolute; inset: 0;
        width: 100%; height: 100%;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
        display: block;
      "></canvas>
    </div>
  `;

  const shell = document.getElementById("froyo-shell");
  const canvas = document.getElementById("froyo-canvas");

  const game = new RacerGame(canvas);

  // Preload the racer's assets (car GLB, textures, fonts, sfx) while the
  // splash + dev/platform cinematics play on the DOM overlay, so the reveal
  // drops straight into the intro radar / menu — no loading bar flash.
  game.warmup();

  // Boot cinematic: splash → dev logo punch → BUILT WITH ★ STAR → reveal.
  // onReveal() starts the game render loop; the overlay lifts off underneath.
  runIntro({
    root,
    audio,
    onReveal: () => game.start(),
  });

  // Touch controls overlay (mobile only, no-op on desktop)
  // createTouchOverlay(shell, game.input);

  window.addEventListener("beforeunload", () => game.stop());
});

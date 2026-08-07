# ap3xthe0ry — PS1 Arcade Racer

A software-rasterized, retro-style arcade racer built around a 320×240 CPU renderer.

## Run Online

https://crawlspaceinteractive.github.io/ap3xthe0ry/

## Run locally

```bash
python3 -m http.server 8000
# open http://127.0.0.1:8000/index.html
```

## Layout

- `index.html` / `main.js` — HTML shell, fullscreen canvas, boots `RacerGame`.
- `engine/` — renderer, math, input, texture loader, GLB support, audio, mobile touch.
- `racer/` — race logic, track spline, vehicle physics, HUD, sound, sky, scenery.
- `assets/` — textures, sprites, 3D models, audio.
- `tools/` — editor and dev utilities (`scene-editor.html`, `hotreload`, level validator).
- `docs/` — architecture, design, changelog, checkpoints.

## Notes

- The active entrypoint is `main.js` → `racer/racergame.js`.
- The renderer writes into a 320×240 `ImageData` buffer and upscales to 640×480 with pixelated output and Bayer dither.
- The `game/` folder contains legacy parent-project engine code and is not part of the current racer build.

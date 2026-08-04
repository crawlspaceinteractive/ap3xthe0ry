# Froyo Engine (crawlspaceEngine)

PS1-style software-rasterized Arcade Racer. All rendering is CPU-side into a
low-res `ImageData` buffer — no WebGL for visuals (Three.js is used only to
parse GLB files).

## Run Online

https://crawlspaceinteractive.github.io/ap3xthe0ry/

## Run locally

```bash
python3 -m http.server 8000
# open http://127.0.0.1:8000/index.html
```
## Layout

- `main.js` / `index.html` — entry shell
- `engine/` — renderer, geometry (GLB), input, camera, audio, textures
- `game/` — game logic, world gen, physics, HUD, AI
- `tools/` — scene editor (`tools/scene-editor.html`), level format validator,
  hot-reload (`?hotreload[=path]`), mapgen export
- `data/` — persistence

## Docs

- `ARCHITECTURE.md` — file map + subsystem notes (read first when editing)
- `DESIGN.md` — design decisions
- `CHANGELOG.md` — APPEND-ONLY session history (regression guard)

## Debug

- **F** during gameplay — flycam (world freezes; WASD + Q/E yaw, R/V pitch,
  Space/Ctrl vertical, Shift fast) // Commented out
- `?hotreload` — polls `maps/dev-level.json` and reloads the world on change

# AP3X THE0RY (crawlspaceEngine racer)

A PS1-style software-rasterized arcade racer built on the shared Crawlspace
engine. All rendering is CPU-side into a low-res framebuffer — no WebGL for
visuals (Three.js is used only to parse GLB models). A drifting arcade
vehicle laps a closed spline track under a parallax fuji-sky, with a neon
summit aesthetic and a steel-numeral sprite HUD.

## Run locally

```bash
python3 -m http.server 8000
# open http://127.0.0.1:8000/index.html
```

Game assets (textures, GLB model, audio) resolve through
`engine/asseturls.js`: the Git tree keeps nested folders
(`assets/2D/…`, `assets/3D/…`, `assets/audio/…`) while `assetUrl()` maps each
file's basename to the flat Supabase CDN bucket. Unknown names pass through
unchanged, so same-origin files (e.g. `assets/3D/maps/test_track.json`) work
locally. Missing GLB models fall back to procedural geometry and log a warning.

## Boot flow

`main.js` mounts a 640x480 canvas (internal 320x240 render upscaled 2x +
dithered) and starts `RacerGame`. States: INTRO (warning card → title swoop
→ PRESS START rev) → MENU → RACE ⇄ PAUSE.

## Controls

- WASD — throttle / brake+reverse / steer
- SHIFT — drift (hold + steer, release to boost)
- R — rear view (hold)
- T — reset car
- START / B — pause
- Gamepad: left stick steer/throttle, A gas, X drift, B brake, START pause

## Layout

- `main.js` / `index.html` — entry shell (mounts 640x480 canvas, boots
  `racer/racergame.js` via `RacerGame`)
- `racer/` — the arcade racer: game orchestrator, vehicle physics, track,
  chase cam, HUD + sprite fonts, menus, lap timer, audio, sky, scenery
- `engine/` — shared Crawlspace core: software renderer, geometry (GLB),
  input, audio, textures, sprite fonts, tunables
- `game/` — LEGACY Froyo platformer (superseded by the racer; still present)
- `tools/` — scene editor, level-format validator, hot-reload,
  mapgen-export, meshweld
- `data/` — persistence

## Docs

- `docs/ARCHITECTURE.md` — file map + subsystem notes (read first when editing)
- `docs/DESIGN.md` — design decisions + journal
- `docs/CHANGELOG.md` — APPEND-ONLY session history (regression guard)

## About the ABOUT page

The in-game ABOUT menu renders `docs/README.md` + `docs/CHANGELOG.md`
(wrapped at 48 chars, scrollable) — keep lines short so it reads well
in-game.

<｜DSML｜parameter name="filePath" string="true">/home/crawlspacedev/Desktop/ap3xthe0rydemoiso-star/docs/README.md
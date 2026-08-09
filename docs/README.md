# AP3X THE0RY (crawlspaceEngine racer)
<img width="1280" height="582" alt="Screenshot 2026-08-09 at 03-27-39 ap3xthe0ry_demo iso" src="https://github.com/user-attachments/assets/e59b128c-3bb7-45f0-bfb9-ae2ae78e5a3f" />
<img width="853" height="480" alt="Screenshot 2026-08-09 at 03-25-40 apex theory - YouTube" src="https://github.com/user-attachments/assets/2cb67464-bfb3-4977-a75c-ccda561ada3c" />
A PS1-style software-rasterized arcade racer built on the shared Crawlspace
engine. All rendering is CPU-side into a low-res framebuffer - no WebGL for
visuals (Three.js is used only to parse GLB models).

## Run In-Browser

https://crawlspaceinteractive.github.io/ap3xthe0ry/

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

<img width="1280" height="582" alt="Screenshot 2026-08-09 at 03-27-53 ap3xthe0ry_demo iso" src="https://github.com/user-attachments/assets/59d81891-7920-4872-aac1-e0473ed0c31b" />

## Boot flow

`main.js` mounts a 640x480 canvas (internal 320x240 render upscaled 2x +
dithered) and starts `RacerGame`. States: INTRO (warning card → title swoop
 → PRESS START rev) → MENU (looped U-Turn theme, PLAY submenu) → RACE ⇄ PAUSE.
Entering a course now shows a quick map-select globe loading screen with an
orange LOADING bar before the race begins.
- SHIFT — drift (hold + steer, release to boost)
- R — rear view (hold)
- T — reset car
- START / B — pause
- Gamepad: left stick steer/throttle, A gas, X drift, B brake, START pause

<img width="1280" height="582" alt="Screenshot 2026-08-09 at 03-28-47 ap3xthe0ry_demo iso" src="https://github.com/user-attachments/assets/6aec9c66-d1e6-4607-87b9-52f3d1bcf54c" />

## Layout

- `main.js` / `index.html` — entry shell (mounts 640x480 canvas, boots
  `racer/racergame.js` via `RacerGame`)
- `racer/` — the arcade racer: game orchestrator, vehicle physics, track,
  chase cam, HUD + sprite fonts, menus, lap timer, audio, sky, scenery
- `engine/` — shared Crawlspace core: software renderer, geometry (GLB),
  input, audio, textures, sprite fonts, tunables
- `game/` — LEGACY Froyo platformer (kept for mining / porting back into
  the engine feature list; not loaded by the racer)
- `racer/levels.js` — course catalog (LEVELS); AHURA + maps from
  `assets/3D/maps/manifest.json` (hydrate at boot)
- `tools/` — scene editor, spline-editor, level-format validator,
  hot-reload, mapgen-export, meshweld
- `data/` — persistence

<img width="1280" height="582" alt="Screenshot 2026-08-09 at 03-28-20 ap3xthe0ry_demo iso" src="https://github.com/user-attachments/assets/bb708f62-39c6-49ca-8028-950e16fc6243" />

Debug: `?level=hill-test` or `?level=2` picks a course from LEVELS
(also seeds the COURSES menu highlight). In-game: PLAY → TIME ATTACK →
COURSE list (iso preview orbit + live track swap).

## Docs

- `docs/ARCHITECTURE.md` — file map + subsystem notes (read first when editing)
- `docs/DESIGN.md` — design decisions + journal
- `docs/CHANGELOG.md` — APPEND-ONLY session history (regression guard)

## About the ABOUT page

The in-game ABOUT menu renders `docs/README.md` + `docs/CHANGELOG.md`
(wrapped at 48 chars, scrollable) — keep lines short so it reads well
in-game.

<｜DSML｜parameter name="filePath" string="true">/home/crawlspacedev/Desktop/ap3xthe0rydemoiso-star/docs/README.md
<img width="1280" height="582" alt="Screenshot 2026-08-09 at 03-27-31 ap3xthe0ry_demo iso" src="https://github.com/user-attachments/assets/a317b82d-1d38-45f8-97a9-d4b17ddd6a08" />

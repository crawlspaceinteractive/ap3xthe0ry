# AP3X THE0RY — Design Document

## Concept
A PS1-style software-rasterized arcade racer. A fast, drifting vehicle laps a
closed spline track suspended over a neon summit: layered parallax fuji-sky,
boot cinematic title, steel-numeral HUD, and a shuffle soundtrack. Built on
the shared Crawlspace engine.

## Core Mechanic
High-speed cornering built around the drift: hold drift + steer to swing the
rear out, charge tiers while sliding, release to bank a boost. Steering is
speed-sensitive, walls bounce with speed loss, ramps auto-boost off the lip,
and the lap clock is tracked exactly along the closed track spline.

## Art Style
320x240 internal software-rasterized framebuffer, upscaled 2x + dithered onto
a 640x480 canvas. PS1 vertex jitter, Bayer 4x4 dither, 15-bit color
quantization, distance fog. The vehicle is a user-authored GLB; terrain,
track, and sky are pure-JS geometry. Palette: deep violet night, magenta
accents, orange UI glow, steel-blue numerals.

---

## Design decisions

### Rendering (shared engine)
- CPU software rasterizer only - no WebGL. All pixels write into a
  Uint32Array framebuffer (ImageData) behind 2D canvases.
- Two geometry paths: procedural builders (renderer.js) and GLB meshes
  (geometry.js; Three.js used only to decode .glb).
- buildMeshTris uses the same projection math as the procedural path.
- Depth-buffered painter's draw; 16.16 fixed-point scanlines; PS1 dither,
  vertex snap, 15-bit quantize, distance fog.

### Asset pipeline
Assets are tracked in nested Git folders under assets/ but served from a
flat CDN bucket. engine/asseturls.js maps each basename to its CDN UUID;
assetUrl() strips the directory. The shim keeps all 163 racer assets
verifiable 1:1 against the flat bucket. Unknown names pass through.

### Vehicle (racer/vehicle.js)
- Arcade drift model with speed-sensitive steering, handbrake drift,
  tiered boost charge, wall bounce with sticky drag, ramp lips, flips,
  respawn on fall-off.

### Track (racer/track.js)
- Closed Catmull-Rom loop sampled once for physics AND rendering, so the
  drawn road equals the drivable road. Ramp/gap flags per sampled point.

### HUD / fonts (racer/)
- Sprite numeral + smallfont glyphs with tight advance metrics. Small
  digits are the 32x42 speedometer set; big digits are the 64x82 position
  set; ordinals on position. Drawn after the 3D pass.

### Audio (racer/racersound.js)
- Shuffled 22-track playlist + engine/screech loops + crash/land/boost/
  tier blips; 1s rev with fade-out.
- Main menu now loops track 22 U-Turn as its own theme, with confirm/deny/select
  menu SFX and a dedicated race shuffle handoff.

Notes on boot audio reliability:
- The DOM-overlay intro (`racer/intro.js`) preloads the crash/punch SFX and
  awaits that buffer before starting the logo punch so the impact plays
  exactly on cue (avoids browser audio suspension race conditions).
- `RacerGame.warmup()` begins background asset fetches (GLB, fonts, SFX)
  before the intro reveal so the game can start without a loading-bar flash.

### Input
- `Escape` no longer doubles as confirm. It's handled explicitly as a BACK
  edge via `keyJustPressed("Escape")` in the menu controller and pause
  handling; hint strings were updated from `K/BKSP:BACK` to `ESC:BACK`.

### Menus (racer/menus.js)
- MenuController owns MAIN / GAMEMODES / COURSES / CONTROLS /
  OPTIONS / BINDINGS / ABOUT. COURSES scrolls levels.js LEVELS.
- PLAY opens a GAMEMODES submenu (SINGLE RACE / TIME ATTACK / HEAD2HEAD), and
  course entry now uses a brief loading screen with the map-select globe.
- Pause is a menu mode (enterPause) with the same sliders/bindings as
  Options; QUIT rebuilds the vehicle and returns to MENU.

---

## Design decisions kept from the platformer era (game/)

These notes predate the racer; the code remains in game/ as **legacy —
intentionally kept**. Mine it later or port features back into the shared
engine feature list. The racer boot does not load it.

- Double-jump + glide, one-way platforms, bridge spline pass, biomes.
- Enemy/boss AI, hazards, collectibles, portal progression, Voronoi
  island world-gen with shape builders.
- Same rasterizer/geometry/color pipeline shared with the racer.

---

## Journal
Newest first. Design narrative only; the authoritative per-session log is
CHANGELOG.md.

- Pause menu moved into MenuController (fullscreen bindings quit shared
  with OPTIONS); 1s rev fade; docs rewrite for AP3X THEO... .
- Intro: warning -> title swoop/slide -> PRESS START -> loading bar;
  options gained fullscreen + rebind; ABOUT renders README+CHANGELOG.
- Best-lap line turns red via body-font tint pass.
- Added smallfont "/" and "1" glyphs; loadHudFonts digit-merge no longer
  clobbers body glyphs.
- Per-mesh GLB textures; "textured" colorMode; Froyo model-swap frames.
- Vehicle facing fix (applyNodeTransforms) + asset CDN migration.
- Off-road now exists beyond the road edge: a drivable grass ramp connects the
  edge to the off-road plane, walls can be randomly open per run, and tire stacks
  appear on open wall sections.
- Minimap auto-scales to each track instead of assuming a fixed range.
- Main menu plays U-Turn, enters courses through a quick LOADING screen, and
  uses confirm/deny menu SFX.

---
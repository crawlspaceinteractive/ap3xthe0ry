# Checkpoint — Audio sliders + file-based SFX + sky parallax + pine trees + standalone SDK + 640×480 rework + analog speedo/mileage + sprite fonts + 320×240 internal upscale-dither + track minimap + world FX sprites + model-anchored headlights + deepsmoke-style headlight beams + bigfont/smallfont UI text + 200% UI pass + red smallfont alerts + HUD layout tweaks + translucent 2× speedometer + lap times

## Completed This Session

### 1. Audio sliders in the racer pause menu (Task B)
- `racer/racerhud.js` — `drawPause()` rewritten from 3 lines of text into a panel with
  RESUME / SFX VOL / MUSIC VOL rows and slider bars (fill + % text, SEL/DIM colors),
  matching the original game's settings-panel slider style.
- `racer/racergame.js` — added `_tickPause()` with W/S row select (axisY edge-detect),
  A/D adjust in 0.05 steps with auto-repeat (`_settingsHeld`), Start/A resumes.
  Volume read/write through `racerSound.getVolumes()` / `setSfxVol()` / `setMusicVol()`.

### 2. Silent-SFX root cause fixed — file-based car sounds (Task A)
- Root cause was the SDK baking synth waveforms at 3% amplitude (~-30 dB) — inaudible
  under full-volume music, unrecoverable by any slider.
- `racer/racersound.js` now uses generated audio files:
  - `assets/audio/sounds/sfx_engine_loop.mp3` — engine hum loop (pitch still rides speed)
  - `assets/audio/sounds/sfx_screech_loop.mp3` — tire screech loop
  - `assets/audio/sounds/sfx_crash.mp3` — wall crash
  - crunch / boost / tierup remain synths (asset credits were exhausted — regenerate
    the files later and swap the `synth:` defs for `src:`).
- Added `getVolumes()` / `setSfxVol(v)` / `setMusicVol(v)`; every loop volume and
  one-shot `{volume}` is scaled by `_sfxVol` (SDK `handle.setVolume` bypasses group
  volume, so racersound keeps its own multiplier).

### 3. Parallax wrapping sky (Task C) — new `racer/sky.js`
- Loads `fuji_sky_layer_back/middle/front.png` via `loadTexture`, prescales each once
  into a Uint32Array strip (back 120px / middle 100px / front 84px).
- `blit(rd, yaw, pitch)` stamps the 3 layers back→front after `clearSky`, bottom-anchored
  at the horizon (`HALF_H + pitch*2.1`, clamped 60..150). X scroll = accumulated yaw ×
  `PX_PER_DEG × parallax` (0.7 / 1.3 / 2.34), wraps mod stripW, alpha<128 texels skipped.
- **Yaw continuity (wrap-flip fix)**: cam yaw is non-monotonic (atan2 → [-180,180],
  heading 359°→0°). The blit accumulates the smallest signed angular delta each frame
  instead of recomputing xoff from raw yaw — the old code jumped ~257px (nearly a full
  screen) at the 359°→0° boundary.
- **Full-width strips**: strips keep the entire 1024px source width (height scaled to
  target only), so the full 360° panorama is used and the tile period matches it.
- **Seam blend**: the first/last 4 columns of each strip are crossfaded so wrap-tiling is
  perfectly seamless (measured seam = 0 on all 3 layers).

### 4. Pine trees lining the track (Task D) — new `racer/scenery.js`
- Loads `pine_sway.gif` with `cropToContent: true`; places trees every 5th sample on
  both sides, skipping ramps, offset `hw + GRASS_W + RUMBLE_W + 1.5 + jitter`, scale 2.8–4.2.
- Per-frame: culls at 165 units, builds a camera-facing textured quad via
  `buildTexturedFace` (right vector = `(cos(yaw),0,-sin(yaw))`), pushes into the shared
  tris array before the painter sort. Alpha-cutout handled by `drawTexturedTriangle`.
  Wind sway: top corners lean by `sin(frame*0.03 + phase)*0.3`.

### 5. Standalone SDK — removed star-sdk dependency
- `engine/tunable.js` — local replacement for `/star-sdk/v1/dom.js` `tunable()`. Reads
  the `<script id="__star_tune">` JSON in index.html, merges over code defaults.
- `engine/sdk-audio.js` — local replacement for `/star-sdk/audio.js` `audio`. Web Audio
  API implementation: synth defs rendered offline, file defs fetched+decoded,
  `preload`/`play`/`setMusicVolume`/`setSfxVolume`, Howler-compatible handles
  (`setVolume`, `playing`, `._howl.rate()`).
- Updated all racer + game imports to the local shims (only `tools/main.js` still
  references star-sdk, and that's a dev tool).

### 6. Asset paths → local (no CDN/Supabase)
- `racer/racergame.js`: textures now `assets/2D/textures/`, GLB `assets/3D/models/ahura.glb`.
- `racer/racersound.js`: music now `assets/audio/soundtrack/`, SFX `assets/audio/sounds/`.
- `game/textureatlas.js`: all terrain URLs → `assets/2D/textures/*.png`; portal/sparkle/
  icons set to `null` (no local files).
- `engine/audio.js`: BGM → `assets/audio/soundtrack/1._collector.mp3`.
- `game/game.js`: BRIDGE_SPRITE_URL → `null` (uses documented color-plank fallback).
- Remaining CDN: three.js library imports (esm.sh / jsdelivr) — library deps with a
  procedural-kart fallback in the racer.

### 7. Textured ground plane (hides the void under the track)
- Replaced the flat solid-green ground quad with a camera-centered, subdivided grid
  (10×10 cells over ±340 units) textured with `assets/2D/textures/grass.png`
  (`buildTexturedFace`, world-anchored UV at the same 0.07 tile scale as the grass
  aprons so the terrain continues seamlessly). Solid-color fallback if grass fails
  to load. Keeps the +500 avgZ sort bias (drawn behind all track geometry) and the
  `camera.y > gy` gate.
- Why: the old flat quad fogged to the pink sky-bottom color at distance, so the area
  below the horizon read as "sky/water" instead of ground. Textured grass clearly
  reads as terrain from the road edge out to the horizon fog.

### 8. Far-screen fog → sky occlusion (fog-to-sky mode)
- Request: at the far screen edges the ground fogged to a flat pink band just below
  the horizon; the user wanted those pixels occluded with the sky drawing behind.
- Root cause: `FOG_NEAR=20` / `FOG_FAR=500` (defaults) exceed the ground plane radius
  (340, corners ~481), so every ground pixel was drawn, fogged toward the flat
  `FOG_COLOR` ([200,160,200] pink). The ground's vanishing-line band (rows 79-84,
  distances 100-480+) sat ~50-96% fogged → the pink band at the "far edges".
- `engine/renderer.js`:
  - New **fog-to-sky mode** (`_fogToSky`), enabled by the new `setFogDistance(near, far)`.
    At FULL fog (`t256 >= 256`) the pixel is culled — color AND depth left untouched —
    so the sky drawn behind it (gradient + clouds + parallax mountains) shows through.
    Fog now also blends toward the sky gradient for that screen row (`rd.skyRows[y]`)
    instead of the flat `FOG_COLOR`, so the partially-fogged band dissolves into sky
    (no flat-pink band).
  - `FOG_NEAR`/`FOG_FAR` became `let`; `_FOG_RANGE_INV` moved up with them; derived
    fog LUT + range inv rebuild via `_rebuildFogConstants()`. Games that never call
    `setFogDistance` keep the exact old default behavior (verified: no cull, flat pink).
  - Applied in both `drawTriangle` and `drawTexturedTriangle` (per-row fog target +
    full-fog cull). `drawPixelW` unchanged (uses the rebuilt LUT).
- `racer/racergame.js`: constructor calls `setFogDistance(20, 170)`. FOG_FAR sits just
  past the track's cull distance (165) so the full road length stays drawn; everything
  beyond (the ground's far band at 130-480 units) culls to sky.
- Verified numerically (Python projection sim, camera height 2.5-5, pitches 6/10/16):
  with the fix, ground rows 79-80 are pure sky and the last drawn row (~81, d 130-170)
  is a sky-colored haze; without it those rows were 45-96% flat pink. Smoke-tested the
  real module in Node: far tri (z 250) drew 0 px → sky color; default (no
  `setFogDistance`) still draws far tris fogged pink.

### 9. Internal render resolution 320×200 → 640×480
- **Policy**: preserve the old FOV (~100°×80°) exactly. All screen-space constants now
  derive from `SCREEN_W/HALF_W/HALF_H/FOCAL_*` in `engine/luts.js`:
  - `SCREEN_W 640`, `SCREEN_H 480` (HALF via shift = 320/240).
  - `FOCAL_X 269` = `HALF_W/tan(50°)`, `FOCAL_Y 286` = `HALF_H/tan(40°)`.
    Verified: FOV_x = 99.90°, FOV_y = 80.00° (identical to old 320×200). `SCALE_TABLE_*`
    and `scaleAtX/Y` rebuild automatically from the new focal lengths.
  - World-space constants untouched (fog `setFogDistance(20, 170)`, `CULL_DIST 165`,
    track geometry) — resolution only affects screen-space code.
- Files changed (all `node --check` clean):
  - `engine/luts.js` — new resolution/focal block with derivation comments.
  - `engine/geometry.js` — imports `SCREEN_W/SCREEN_H/HALF_W/HALF_H` from luts; removed
    the local `320/200/160/100` constants; `CAM_FOV 80`, `CAM_ASPECT = SCREEN_W/SCREEN_H`.
  - `engine/renderer.js` — header comment; added `drawLine` (Bresenham) + `drawCircle`
    (midpoint outline / scanline fill) HUD primitives (no depth, no fog) after `drawRect`.
  - `racer/sky.js` — layer target heights now `(SCREEN_H*0.60)|0 = 288`,
    `0.50 → 240`, `0.42 → 201`; horizon = `HALF_H + pitch*(FOCAL_Y*π/180)` clamped
    `(HALF_H − SCREEN_H*0.20)`..`(HALF_H + SCREEN_H*0.25)` (px/deg now ~5.0).
    Chase-cam pitch 10° → horizon row 289 (60% down, same relative placement as before).
  - `main.js` — canvas `width="640" height="480"`.
  - `game/game.js` — imports `SCREEN_W/SCREEN_H`; `_tickLoading` `SW/SH` from luts;
    removed three local `const SCREEN_W = 320, SCREEN_H = 200` shadows.
- **No edits needed** (verified): `engine/spritesheet.js` clamps via imported constants
  (already res-agnostic); `game/hud.js` layout is `SCREEN_W/SCREEN_H`-relative (island
  game has no mounted HTML entry — compile-only); `tools/main.js` uses its own
  `W=800, H=450` canvas + `PLAYER_HALF_H` hitbox (false positive). `racer/track.js`,
  `game/islandatlas.js`, `game/world.js` grep hits were `HALF_WIDTH`/`TARGET_HALF_W`
  world-space names.

### 10. File-based SFX for crunch/boost/tierup (completes section 2)
- `racer/racersound.js` — the last three `synth:` defs (crunch/boost/tierup) swapped for
  `src:` file defs pointing at `assets/audio/sounds/sfx_crunch.mp3` / `sfx_boost.mp3` /
  `sfx_tierup.mp3` (all `group: "sfx"`). All procedural one-shots now gone.
- Silent placeholders created with ffmpeg (`anullsrc`, 0.2s, mono 44.1kHz, q:a 9):
  ~1163 bytes each, valid MP3s (ffprobe duration 0.235s). `play()` fails gracefully
  until the real files replace them.
- Verify decision recorded: play failures are acceptable while placeholders are in.

### 11. Analog speedometer + mileage ticker (`racer/racerhud.js` full rewrite)
- **`drawSpeedo(rd, kmh)`** — procedural analog gauge centered `(SCREEN_W−100,
  SCREEN_H−90)`, radius 56: rim ring + dark face, major/minor ticks every 50/25 up to
  300 (redline marks ≥250), 3px needle at the right sweep angle (270° arc starting at
  135°), center hub. Rendered behind the digital readout.
- **Digital speed** — `round(|speedF|*216)` at scale 4 centered in the gauge face,
  "KMH" scale 2 below.
- **`drawMileage(rd, v)`** — center-top ticker: `km = odometer/1000` padded to 7 chars
  (`0000.12`), "MI" label, panel at y=6 with highlight border. Driven by the new
  `v.odometer` field (`racer/vehicle.js`), accumulated `+= |speedF|` per 60Hz fixed step
  after `stepVehicle` in `racer/racergame.js`; speedF reset to 0 on respawn.
- **Rest of HUD scaled for 640×480**: drift bar `220/372/200/12` + "DRIFT" label,
  BOOST!/RESPAWNING/FLIP indicators, and 2×-scaled title ("AHURA GP" scale 8),
  pause panel (240×124, SFX/MUSIC sliders with %), and loading screens.
- `racer/racergame.js` particle sizes 1→2 (smoke/boost/landing dust) for parity at 2×.

### 12. Verification done this round
- `node --check` clean on all 10 edited files.
- Node module smoke test at 640×480: FOV preserved (99.9×80°); `clearSky` fills the
  buffer; fog-to-sky still culls far tris (z 250 → 0 px) and draws near tris (z 30 →
  161 px); `drawLine/drawCircle/drawRect/drawText` run bounds-safe.
- Dev server (`python3 -m http.server 8000`, pid 609648) serves all edited modules +
  the 3 new placeholder MP3s with 200s.
- No headless browser available — visual playtest (needle sweep, ticker, sky, layout)
  still required by the user at `http://127.0.0.1:8000/index.html`.

### 13. Sprite fonts for numerals (`assets/2D/ui/fonts/numbers/`)
- User added digit PNGs: `speedometer/` 0-9 (32×42) and `position/` 0-9 + 1st/2nd/3rd
  (64×82). Speedometer digits are steel-blue-gray, position ordinals gold (verified by
  pixel sampling); backgrounds transparent so the alpha-cutout blit works.
- **New `racer/hudfont.js`**:
  - `loadHudFonts()` — loads all 23 PNGs in parallel via `loadTexture` (returns
    `{width,height,data}` views; failure → null, non-blocking). Returns
    `{ speed: {0-9}, pos: {0-9}, suffix: {1st,2nd,3rd} }`.
  - `drawNumber(rd, glyphs, str, x, y, targetH, gap)` — nearest-neighbour blit via
    `drawSpriteFit` with a fixed glyph pitch, returns drawn width (used for centering).
  - `drawPlace(rd, fonts, place, x, y, targetH, gap)` — uses the combined ordinal
    sprite for 1-3 (avoids double-drawing the digit), plain digits otherwise.
- `racer/racerhud.js` (v0.3):
  - Speed readout → speedometer font at native 42px, centered in the gauge face
    (`GAUGE_CY+10`); "KMH" label moved outside the face to the right
    (`GAUGE_CX+R+8`).
  - Mileage ticker → speedometer font at half size (21px = crisp 0.5×) with 2px
    glyph gap; "MI" label stays bitmap text (no glyph for letters).
  - New placeholder position display at top-left (16,12) at native 82px using the
    position font — driven by a future race system.
  - Bitmap-text fallback retained whenever `fonts` is missing.
- `racer/racergame.js`: loads fonts in `_load()` (added to the Promise.all), stores
  `this.hudFonts` + `this.place = 1` (placeholder), passes both to `drawRacerHUD`.
- Verified: `node --check` clean; mock-sprite smoke test confirms glyph pitch/width
  math (`"238"` = exactly 96px, nothing outside the band; place 1 = combined sprite
  only = 64px), full-HUD render paints all five regions, and the null-font fallback
  runs. Server serves `hudfont.js` + the digit PNGs (200).

### 14. Internal render 320×240 → 2× upscale → 640×480 dither (PS1 chunky blocks)
- User decision: render internally at 320×240, nearest-neighbour upscale to 640×480
  FIRST, then apply the Bayer dither — so the 4×4 threshold cell follows the OUTPUT
  grid and every 320×240 pixel becomes a chunky 2×2 dithered block (very PS1).
- `engine/luts.js`: `SCREEN_W/H` → 320/240 (`HALF` 160/120), new `OUT_W/H` 640/480 +
  `UPSCALE = 2`. FOCAL_X re-derived 269→134, FOCAL_Y 286→143 (same ~100°×80° FOV;
  aspect stays 4:3). `SCALE_TABLE_*` rebuild from the new focals automatically.
- `engine/renderer.js`:
  - **Dither moved OUT of the rasterizers.** `drawTriangle` / `drawTexturedTriangle`
    now write full 8-bit fogged color (`_BAYER` precompute + `by` removed), and
    `drawPixelW` drops `quantize15` — no more per-pixel dither at render time.
  - `createRenderer` keeps the 320×240 `buf32/depth/skyRows` (via `ctx.createImageData`)
    and adds `rd.display = { image: 640×480 ImageData, buf32: Uint32Array }`.
  - `present(rd, warp, fade)`: warp/fade still runs on the 320×240 buffer, then a new
    loop nearest-upscales each source pixel into a 2×2 output block, calling
    `quantize15(c, ox, oy)` per OUTPUT pixel (Bayer keyed on output coords), then
    `putImageData(display.image)`. `UPSCALE` constant used so it's not hardcoded 2.
  - Header comment + imports updated (BAYER_4X4 no longer imported here; quantize15
    used by present).
- `racer/racerhud.js` (v0.4): every fixed-px size halved so the 2× upscale lands on
  the previous 640×480 sizes — gauge R 28 (→56 out) at `SCREEN_W−50/SCREEN_H−45`,
  ticks 4/8 & 2/6, hub 2, needle tip `R−8`, speed digits 21 (→42), mileage 10/1px gap,
  position targetH 41 at (8,6), drift bar 110/186/100/6, all title/pause/loading text
  scales halved, pause panel 120×62, "KMH" at `R+4`, bitmap fallbacks halved too.
- `racer/racergame.js`: particle `size: 2` → `size: 1` (2px sprite → 4px output).
- `racer/sky.js` / `engine/geometry.js` / `main.js`: strip heights + horizon already
  SCREEN_H/FOCAL-relative → auto-halve (back 144/mid 120/front 100 → 2× = old 288/240/200);
  comments updated (FOCAL_Y 286→143, 320×240 framebuffer, 2× upscale note). Canvas
  stays 640×480 = `OUT_W×OUT_H`. `game/hud.js` + `game/game.js` are SCREEN-relative and
  remain compile-only (island game has no HTML mount).
- Verified: `node --check` clean on all touched files; new smoke tests (mock ctx):
  internal buffer 320×240 + display 640×480; flat-100 color → out(0,0)=88/out(1,0)=96/
  out(0,1)=104/out(1,1)=96 with the Bayer cell repeating on the 4px OUTPUT grid;
  nearest-neighbour blocks red/green/blue/yellow from the correct source pixels;
  warp/fade path intact; full HUD (sprite + null-font) + title/pause/loading render
  in-bounds at 320×240 and present to a 640×480 output.

### 15. Track minimap (`racer/racerhud.js` v0.5)
- Top-right, panel-less minimap — only the spline shows (no bg/border rects), at
  `MM_X = SCREEN_W-92` / `MM_Y = 8`, 84px, mapping world x,z over ±140 units (track
  r ≤ ~126) with:
  - outlined spline drawn twice for a crisp PS1 look: a 6px steel base
    `rgba(95,120,155)` with a 4px white line on top (via new generic
    `drawThickLine` in renderer.js — perpendicular pixel-offset scans),
  - gold start/finish tick at `track.spawnIdx`,
  - driver dot (bright teal fill + white ring) + a short heading nub from
    `sinDeg(v.yaw)/cosDeg(v.yaw)` scaled by the map scale.
- `drawRacerHUD` signature grew a `track` arg (backwards-compatible — skipped when
  falsy); `racergame.js` passes `this.track`. Positioned clear of the position
  display (top-left) and mileage ticker (top-center).
- New user-added FX sprites (not yet wired, next task): `assets/2D/sprites/headlight_flare.png`
  (512×512), `lightray.png` (256×256), `smoke_anim.png` (16×128 = 8× 16×16 vertical strip).
- Verified: `node --check` clean; HUD smoke test with a real `buildTrack()` — 241
  samples, minimap renders ~5.2k px (outlined spline + markers only), driver dot
  present at world (0,0)→(270,50) and at spawn, all in-bounds. `drawThickLine`
  width check: 6px horizontal spans exactly 6 rows, 4px vertical exactly 4 cols.
  ASCII dump of the map shows the expected shape (hairpin bottom-left, west
  straight right, spawn at 0°).

### 16. World FX sprites wired (`engine/renderer.js` + `racer/racergame.js`)
- New `drawBillboardSprite(rd, tex, world, camera, opts)` in renderer.js — a
  camera-facing billboard blit with per-texel **alpha blend** or **additive** (glow)
  compositing, depth test (optional `depthBias`), optional `tint` / `fade` /
  strip-sheet `frame`/`rows`/`cols`, and distance fog (sky-gradient target in
  fog-to-sky mode). Size derived from `worldSize` (× `height`) × `scaleAtX/Y(z)`,
  so FX auto-shrink with depth; the soft alphas are composited in the 320×240
  buffer before the present upscale/dither.
- `racergame.js` loads the three sprites (`_load()` Promise.all; `this.fx =
  {flare, ray, smoke}`, `wrap:false` for all):
  - **headlight_flare.png** — twin additive glare billboards at the nose corners
    (`HEADLIGHT_X=0.55 / Y=0.75 / LEN=1.35`, worldSize 0.95, warm-white tint,
    `depthBias:-0.4` so the glow wins over slightly-closer car pixels).
  - **lightray.png** — a ground cone laid ahead of the car: one textured tri with
    apex (u=0.5,v=0) at the nose and the widening dim base (v=1) far, ground height
    sampled via `queryTrack` at apex+base so it rides hills; cone length scales
    with forward speed (`3 + min(12, speed*0.14)`), skipped while airborne /
    respawning. Drawn with the normal textured-tri path (alpha cutout + depth +
    fog) so the car occludes it.
  - **smoke_anim.png** — the 8×16×16 strip now drives drift smoke, boost flames
    (additive), and landing dust: particles carry `sprite` + `maxLife`, and the
    frame advances `(maxLife - life)/maxLife × 8` so puffs go dense→dissipated.
    Drift spawn cadence changed to every 3rd frame (sprite cost vs old 1px dots);
    particles still fall back to `drawPixelW` when `sprite` is null.
- Respawn hides all three (cone + flare skipped while `respawnT > 0`).
- Verified: `node --check` clean; `fx_test.mjs` — 7 unit tests for the blit (center
  write, transparent frame skip, depth occlusion, `depthBias`, additive clamp + opaque
  alpha, tint, `fade=0`); `fx_helper_test.mjs` — 10 tests exercising the real
  `_headlightConeTris`/`_drawHeadlightGlare` via the class prototype (cone tri/UVs,
  airborne skip, flare pixels near nose, respawn skip); full `_render()` over 3 frames
  with fake textures + fallback kart runs clean and dumps a 640×480 PPM (flare ~164 avg
  RGB near the nose, ~13k pink lightray pixels in the road band ahead, smoke grey
  confirmed at the car).

### 17. FX anchored to the model's front corners + textured light-ray planes
- Request: glares must scale with the `carModel` tuning slider (currently
  `"carModel":{"scale":0.6}` in `index.html` `__star_tune`), attach to the model's
  actual front corners, and the light rays must be a textured plane whose sprite TOP
  (v=0) sits at the light source and BOTTOM (v=1) lands at the beam's termination on
  the road.
- `racer/vehiclemesh.js` — headlight rig extraction, mirroring the exact
  scale→roll→pitch→yaw transform of `buildVehicleTris` (incl. `MODEL.scale`,
  `offsetX/Y/Z`):
  - `findHeadlightPoints(tris)` — groups verts into z-extremes (12% band), picks the
    top of the outer 25% width at each, returns `{plus, minus}` (each
    `{left, right, z}`).
  - `prepareVehicleMesh()` now returns `{ tris, fallback, headlights }` on BOTH paths
    (GLB and fallback kart).
  - New exports `carLocalToWorld` / `carLocalDir` / `getHeadlightRig(prep, x,y,z,
    yawDeg, pitchDeg, rollDeg)` — chooses the nose via `cos(MODEL.yawOffset*DEG) >= 0`
    (+Z vs −Z extreme), returns `{ left, right, fwd, scale }`. Verified the rig lands
    on the real rendered nose: fallback kart's widest nose corners are at ±0.76 (front
    wheel arches) × 1.30, distance 1.506 from the axle, symmetric about the car axis,
    `fwd` unit length.
- `racer/racergame.js` — hardcoded `HEADLIGHT_LEN/Y/X` constants removed:
  - `_headlightConeTris` → `_headlightRays(v, cam)`: per-headlight textured quad
    (2 tris): source edge at the headlight corner (elevated), v=0; termination edge on
    the road via `queryTrack` ground height, v=1. Source width `0.5*scale+0.1`,
    base half-width `0.55 + len*0.22`, `len = 3 + min(12, max(0,speed)*0.14)`.
    Skipped while airborne (still needs `grounded && this.mesh`).
  - `_drawHeadlightGlare` — anchored to `rig.left/right`, `worldSize: 0.95*rig.scale`
    so glares scale with the carModel slider; additive, `FLARE_TINT rgba(255,250,235)`,
    `depthBias:-0.4`; skipped during respawn.
  - Render call site renamed to `_headlightRays` (was the stale `_headlightConeTris`).
- Verified: `node --check` clean; `fx_helper_test.mjs` reworked to the new API —
  rig existence/positions on the fallback kart (real `prepareVehicleMesh(null)`),
  yaw-following, 4 ray tris (2 beams), 4 source edge corners, termination farther
  than source, airborne/respawn skips, flare lit ~684 px at the projected headlight.
  22 total tests green; full 3-frame `_render()` dump OK (flares + warm rays visible
  on the frame analysis).

### 18. Deepsmoke-style headlight beams (crossed additive quads + flare)
- User directive: the racer lives inside the deepsmoke project — "look at how the
  headlights were done there for reference, I'd like them to act the same." The
  reference is `modules/headlights.js`: every lamp renders **three ways** so the
  beam reads from all angles — (1) a horizontal quad laid flat at headlight height
  (top/bottom views), (2) a vertical quad rotated 90° around the beam axis (side
  views), (3) a camera-facing lens-flare sprite at the lamp mouth (front views).
  All **additive** so the sprite's dark PNG background adds nothing.
- Racer replication (`racer/racergame.js` + `engine/renderer.js`):
  - `drawTexturedTriangle` gained `opts = { additive, alphaCut, depthBias,
    noDepthWrite, fog }` (defaults preserve the flatsprite behavior exactly:
    cutout >= 128, overwrite write, no bias). In `additive` mode each texel does
    `dst += src * (alpha/255)` with alpha-0 texels skipped — no cutout, so the
    lightray's soft body adds naturally and the black background "eats itself".
    Optional `depthBias` shifts the depth compare; `noDepthWrite` keeps the depth
    buffer intact (matches deepsmoke's `depthWrite:false`).
  - `_drawHeadlightRays` no longer draws billboards. Per headlight rig anchor
    (via `insetAnchor`, the 8px-to-center nudge): a **horizontal** textured quad
    laid flat at `S.y` and a **vertical** quad spanning `S.y ± hw`, both extending
    `len = 5*rig.scale` ahead along `rig.fwd` with `hw = 0.65*rig.scale`. Texture
    v runs along the beam with the sprite's bright core (v=0, alpha 255) at the
    LAMP and the transparent tail at the far end — the lightray.png's bright core
    really is at its top. Both quads drawn additively via `buildTexturedFace`
    tris with `{ additive: true, depthBias: -0.35, noDepthWrite: true }` after the
    scene+car pass.
  - `insetAnchor` nudges along the **camera's screen-right world vector**
    `(cos yaw, 0, -sin yaw)`, NOT raw world X. The first version moved in ±world X
    with a `p.sx < HALF_W` screen-center sign test, which scoots the lamps OUT
    whenever the car heads -Z/-X (there cos yaw < 0 flips which way world +x maps
    on screen). Clamped so a lamp < 8 px from center stops AT center instead of
    crossing it (e.g. when the chase cam pulls way back at speed, the lamps nearly
    meet at 160 instead of flying past).
  - The flare (`_drawHeadlightGlare`) stays: camera-facing additive `drawBillboardSprite`
    at each lamp mouth (size 0.95*rig.scale, tinted, depthBias -0.4, hidden on
    respawn).
- Verified: `node --check` clean; `fx_test.mjs` 15 green (additive tri: alpha-64
  texels ADD warm light over a dark road — r=85, not black; alpha-0 skip;
  tri `depthBias` beats closer depth; `noDepthWrite` leaves depth untouched;
  non-additive cutout of alpha-64 unchanged); `fx_helper_test.mjs` 13 green —
  beam quads draw from the chase cam (198 px, net brighter) AND from a side cam
  (697 px — the vertical quad), no beams while airborne, rig + glare checks.
  Full-scene diff (beams vs airborne): 170 px changed, every one brighter
  (avg +24/channel) in a 24×16 band over the car nose.
- Post-playtest fix (user: "headlights got scooted out instead of in 8px"):
  heading sweep at yaw 0/90/180/270/45 ± updateChaseCam showed the ±world-X nudge
  flips OUT for -Z/-X headings; rewrote `insetAnchor` to move along the camera
  screen-right world vector with a center clamp. Re-verified: every heading
  yields -8/+8 px INWARD (clamped to center at speed); `fx_test.mjs` 15 green,
  `fx_helper_test.mjs` 13 green, diff 166 px all brighter, `node --check` clean.

### 19. Bigfont + smallfont UI text (`assets/2D/ui/fonts/{bigfont,smallfont}/`)
- User split the small font atlas into per-character 16×16 PNGs
  (`assets/2D/ui/fonts/smallfont/`, 64 files: A-Z + a-z + `! " ' ) + , - . : ; ? {`)
  and added the 32×64 bigfont letters (`assets/2D/ui/fonts/bigfont/`, 25 files —
  **V is missing**). Bigfont is for menu titles/headers; smallfont for body text.
- `racer/hudfont.js`:
  - `loadBodyFonts()` loads both sets via `loadTexture` and wraps each glyph with
    tight advance metrics (`withMetrics`: content bounding box → `{ s, minX, adv }`).
  - `loadHudFonts()` now also returns `big` + `body` maps and merges the speedometer
    digits into `body` (smallfont has no digit art), so body text renders 0-9.
  - `drawGlyphText(rd, glyphs, str, x, y, targetH, color, gap, alt)` — full-cell blit
    shifted by `minX` (consistent baselines), advance = content width; missing glyphs
    fall back to the 5×4 bitmap `drawText`; `color = null` keeps the glyphs' baked
    colors, otherwise the glyph is repainted flat with that ABGR color.
  - `measureGlyphs` + `measureBigText` / `measureBodyText` / `drawBigText` /
    `drawBodyText` convenience wrappers; `drawBigText` falls back to the smallfont
    map (`alt`) for letters bigfont lacks (i.e. V).
- `racer/racerhud.js` (v0.6): `drawTitle` (bigfont "AHURA GP", smallfont subtitle/
  instructions), `drawPause` (bigfont "PAUSED", smallfont rows + hint), `drawLoading`,
  and the HUD accents (KMH/DRIFT/BOOST!/FLIP!/RESPAWNING/MI) use the sprite fonts
  when loaded; every site keeps the bitmap path as the fallback. Accent text is
  tinted flat with its existing color; titles/body use the baked colors.
- `racer/racergame.js` — `drawLoading`/`drawTitle`/`drawPause` now receive
  `this.hudFonts`.
- Verified: `node --check` clean on all three files; module graph imports under Node;
  measure/draw math checked against the real PNGs (title 132px @ targetH 34, all
  title/pause strings fit); baked blit emits the glyphs' grayscale/bronze shading and
  tinted blit emits exactly the tint color; missing-V falls back to smallfont;
  server 200s for index + both font dirs. fx regression tests still green (166 px).

### 20. 200% UI pass + red bigfont alerts + mileage revert (`racer/racerhud.js` v0.7)
- User decisions: scale ALL text up 200% (including the big speed/position numerals;
  long title instruction lines wrap onto two lines), alerts use the **bigfont tinted
  red**, and the mileage meter keeps its pre-v0.6 layout (only the MI letters swap).
- `racer/racerhud.js` (v0.7):
  - Alerts render in the **smallfont** (legible now at 2×): BOOST!/FLIP!/RESPAWNING
    via `drawBodyText` at targetH 36/36/30, gap 2, centered with `measureBodyText`
    (BOOST! 161 / FLIP! 105 / RESPAWNING 245 px — all fit 320). FLIP! and
    RESPAWNING are tinted `ALERT_RED = rgba(255,60,60)`; **BOOST! is tinted the
    boost tier color** `TIER_COLORS[min(2, v.boostTier)]` (matches the boost flash).
  - 2× everywhere: title "AHURA GP" @68, subtitle @22, press line @16, instructions
    @16 wrapped into six centered lines (WASD: DRIVE / SHIFT: DRIFT / S: BRAKE
    R: REARVIEW / T: RESET / HOLD DRIFT + STEER, / RELEASE TO BOOST); PAUSED @26,
    rows @16, slider % @14, hint @12 in a resized 280×190 panel (slider under each
    label, `SW 180`, rows 40px apart); LOADING @22; HUD KMH @12 (moved above the
    gauge, `GAUGE_CX-16,150`, since @12 right of the gauge overflows 320), DRIFT
    @12, speed digits 21→42 centered in the gauge (`GAUGE_CY-16`), position 41→82.
  - Bitmap fallbacks scaled to match (title scale 6, subtitle/press/instr 2, pause
    rows 2, loading 2, alerts 2/4, KMH 2, speed fallback 4).
  - `drawMileage` reverted to the exact pre-v0.6 geometry (`labelScale 1`, `labelW =
    2*5`, label at `px+2,py+3`) — only the MI render swaps to `drawBodyText` at
    targetH 5 (matches the 5px bitmap footprint), digits/panel untouched.
  - Fixed a latent null-fonts crash: `if (fonts.body)` → `if (fonts && fonts.body)`
    at the DRIFT site (found by the HUD smoke test).
- **BUG FIX `racer/hudfont.js`** (`blitGlyph`): the tint branch tested `tint < 0`,
  but any opaque ABGR color (bit 31 set) is NEGATIVE as int32 — so every tinted
  glyph (KMH, DRIFT, alerts, MI, pause rows) silently rendered its BAKED colors
  instead of the tint. Changed to `tint === -1` (the `color == null` sentinel).
  Verified: BOOST! alone now blits 1471 exact `0xff3c3cff` px, zero others.
- Verified: `node --check` clean; all 2× strings measured against the real PNGs and
  every one fits its container (title 250.9 / sub 277.9 / press 284 / worst instr
  247 / BOOST 99.4 / FLIP 58.1 / RESPAWN 134.3 / PAUSED 75 / hint 234.8 / KMH 31.3 /
  DRIFT 45.3 / LOADING 120 / MI@5 6.9); `hud_test.mjs` (in-bounds + fallback) and a
  new `hud_v07.mjs` (real PNG fonts: title/pause/loading sprite paths in-bounds,
  FLIP!/RESPAWNING flat ALERT_RED = 6115 px, BOOST! in boost-tier pink = 3092 px)
  pass; `node --check` + fx regression trio
  still green (diff 166 px); server 200s for index/hudfont/racerhud/font PNGs.

### 20.5 HUD layout tweaks (post-v0.7)
- BOOST! alert moved down 40 px (`y` 40→80 sprite / 44→84 bitmap) — now clear of the
  title-block area and near FLIP! at 84 (the two never fire together).
- Drift charge meter lowered in two steps then padded: `BAR_Y` 186→202→234→**229**
  (4 px from the 240 bottom edge; outline rows 228..236).
- **Speedometer 2× + half-opaque** (`racer/racerhud.js` + `engine/renderer.js`):
  `GAUGE_R` 28→56, re-centered `GAUGE_CX=260 / GAUGE_CY=180` (4 px margins), new
  `GAUGE_ALPHA=128`. Added a `blendAt()` src-over helper and an optional trailing
  `alpha` param to `drawRect`/`drawLine`/`drawThickLine`/`drawCircle` (opaque when
  omitted — backwards compatible). The dial now blends over the 3D scene
  (verified: `gauge_blend.mjs` — 8276 face px at the exact 50/50 mix, 0 opaque).

### 21. Lap times (`racer/laptimer.js` + HUD panel, `racer/racerhud.js` v0.8)
- User decisions: counter sits **directly below the mileage ticker**; the fastest-lap
  line above renders white until a record exists, then **red** (stays red for the
  standing record). The time numerals use **the speedometer number font** (same baked
  steel digits as the rest of the game) and the **smallfont for the letters**.
- `racer/laptimer.js` (new, pure/DOM-free — unit-testable under Node):
  - `createLapTimer()` → `{ lap:1, curMs, bestMs, _prevDist, _raceMs, _steps, _lastLapStep }`.
  - `stepLapTimer(lt, track, x, z, hint, dtMs)` — accumulates the lap clock at the
    fixed 60 Hz step; detects a start/finish crossing when arc distance wraps
    high → low past `totalLen*0.5` (forward motion only, reverse ignored). The step
    that returns the car to the line is counted in the completed lap (clock ticks
    before the crossing is recorded). A `MIN_LAP_STEPS=240` (~4 s) guard stops
    seam-wiggle double counts. Returns `q.idx` for the caller's next hint.
  - `resetLapTimer(lt)` — un-arms crossing + clears the current lap clock on race
    start and at respawn teleports (position jumps never count); **bestMs survives**.
  - `formatLapTime(ms)` → `"M:SS.CC"` (stable 7-char width, no HUD reflow).
- `racer/racergame.js` — `this.lapTimer` created in the ctor; `resetLapTimer` on the
  TITLE→RACE transition and on the respawn-end frame (where `placeAtSample` teleports,
  alongside the existing `snapChaseCam`); `stepLapTimer(...)` each `_step` with
  `v.trackIdx` as the query hint; `this.lapTimer` passed as the new last HUD arg.
- `racer/racerhud.js` (drawLapTimer, below the mileage panel at `LAP_PY=20`) — same
  panel style (dark fill + steel border); top line `"BEST " + time` (`--:--.--` until
  a record) targetH 6, counter targetH 8; bitmap fallbacks included. `drawRacerHUD(rd, v, frame, fonts, place, track, lt)` —
  `lt` optional so old calls still work.
- **Numeral font (user follow-up)**: the lap numerals are composed per-run — digits
  blitted with the speedometer sprite font via `drawNumber` (baked steel colors,
  exactly the same sprites as the speed/mileage/position readouts), while the BEST
  letters and the `:` / `.` separators render through `drawBodyText` (smallfont,
  tinted white/red). So the digits are never repainted flat; the white→red behavior
  lives on the BEST letters + separators. `drawLapString`/`measureLapString` split
  each string into digit vs letter runs so measured widths match the draw exactly
  (no panel reflow).
- **Period glyph (user follow-up)**: the smallfont period file was named `.png` — a
  hidden dotfile that tooling/servers keep skipping — and the user renamed it to
  `period.png`. `racer/hudfont.js` now maps the `"."` glyph to `period.png` via a
  `BODY_FILES` override, so `body["."]` loads (the `.` separator renders as the real
  smallfont glyph, not the bitmap fallback dot).
- Verified: `node --check` clean on all four files; new `laptimer_test.mjs` (format,
  full-loop crossing with exact lap time, faster-lap replacement, seam-wiggle guard,
  respawn teleport, reverse motion) ALL PASS; new `hud_lap.mjs` (real PNG fonts:
  BEST letters red when a record exists / white before, digits proven to be the
  steel speed-font palette via a runtime palette check, bitmap fallback, in-bounds)
  ALL PASS; existing hud_test / hud_v07 / measure_v07 / fx trio /
  present_test / gauge_blend all still green; server 200.

## What Remains / Next Steps

- **Font playtest** (user): at `http://127.0.0.1:8000/index.html` check the 200% UI —
  bigfont silver "AHURA GP" @68 / "PAUSED" @26 titles, smallfont alerts (BOOST! in
  the boost tier color, FLIP!/RESPAWNING red), smallfont bronze body text
  (subtitle, 6 wrapped instruction lines, pause rows + % + hint, LOADING, KMH/DRIFT/
  MI). Mileage ticker should look identical to before the font work (only the MI
  letters are smallfont now).
  If any 2× element crowds its neighbors (e.g. BOOST! vs the top-left position
  numeral when a race is running), nudge the y/x constants in `racer/racerhud.js`.
  Note the smallfont has **no digits** (body digits come from the speedometer font)
  and **no `%`** (still blank, same as before).
- **Bigfont V** (user): `assets/2D/ui/fonts/bigfont/V.png` is missing (25 files).
  Every other letter exists; V currently falls back to the smallfont V via the `alt`
  map in `racer/hudfont.js` (`drawBigText`). Drop in a V.png to fix.
- **Playtest** (user): verify at `http://127.0.0.1:8000/index.html` the NEW 320×240
  internal → 2× upscale + output-grid dither: chunky 2×2 dithered blocks, correct
  FOV/horizon (sky strips back 144/mid 120/front 100 internal), gauge/speed/mileage/
  position/particles all land at the same 640×480 screen sizes as before, and the
  dither pattern is a global checkerboard on the output grid (not per-source-pixel).
  Also re-check audio balance, sky scroll direction, tree density, and fog-to-sky
  horizon (`setFogDistance(20, 170)`).
- **Minimap check** (user): dot tracks the car (incl. mid-jump over the ramp), heading
  nub points the right way, panel placement bottom-left doesn't overlap the drift bar,
  and the start tick sits at the launch line.
- **FX playtest** (user): at `http://127.0.0.1:8000/index.html` check the headlight
  beams (deepsmoke-style: horizontal + vertical additive beam quads extending
  forward from each lamp + a camera-facing flare at the lamp mouth, all riding the
  model's front corners and pulled ~8px toward center; beam reach `len = 5*rig.scale`,
  half-width `hw = 0.65*rig.scale`, glare `worldSize` in `racer/racergame.js`).
  Tune sizes if the beams or flares read too big/strong.
- **Drop in real SFX files**: replace the silent placeholders `sfx_crunch.mp3` /
  `sfx_boost.mp3` / `sfx_tierup.mp3` with the actual assets when available.
- **Position display**: replace the placeholder (`this.place = 1`) with real race data
  when a race system exists; consider "th" ordinal sprites for places ≥ 4.
- **Volume persistence**: `__star_tune`-style localStorage persistence for the slider
  values could be added if desired (currently in-memory only).
- **Boot logo** (`boot_logo_front/back.glb`): still not wired to a loading splash.
- **Island game** (`game/`): still has no mounted HTML entry — `game/hud.js` layout is
  res-relative but untuned for 640×480; only compile-checked.

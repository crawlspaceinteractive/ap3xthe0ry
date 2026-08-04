# Checkpoint — Texture Pipeline Fixed

## Completed This Session

### Root Causes Found & Fixed

**Problem 1 �� `crossOrigin` missing in textureloader.js**
- `engine/textureloader.js` `loadImage()` was missing `img.crossOrigin = "anonymous"`.
- Without it, loading images from Supabase CDN URLs and calling `canvas.getImageData()` throws a SecurityError (tainted canvas), which was silently caught and returned `null` for every texture.
- **Fix**: Added `img.crossOrigin = "anonymous"` before `img.src` assignment in `loadImage()`.

**Problem 2 — Broken URL resolution in `game.js`**
- `_loadBiomeTerrainTextures()` was wrapping the already-absolute Supabase CDN URLs in `new URL(url, import.meta.url)`.
- `import.meta.url` can be invalid/undefined in sandboxed module environments, causing the URL constructor to throw or produce garbled paths.
- **Fix**: Removed the `new URL(...)` wrapping; pass the already-absolute CDN URL directly to `loadTexture()`.

**Problem 3 — Missing biome entries in BIOME_TEXTURES**
- `game/textureatlas.js` `BIOME_TEXTURES` only had `grass`, `ice`, `sand`, `bubblegum`, `default`.
- `game.js` requests textures for `"volcanic"`, `"jungle"`, and `"golden"` too; without entries, `getBiomeTextures()` returned `null` for those biomes, so their islands got no textures.
- **Fix**: Added `jungle`, `golden`, `volcanic` entries to `BIOME_TEXTURES` in `textureatlas.js`.

### Files Changed
1. **`engine/textureloader.js`** — Added `img.crossOrigin = "anonymous"` to `loadImage()`
2. **`game/game.js`** — Removed `new URL(url, import.meta.url)` wrapper in `_loadBiomeTerrainTextures()`
3. **`game/textureatlas.js`** — Added `jungle`, `golden`, `volcanic` to `BIOME_TEXTURES`

## How the Texture Pipeline Works (post-fix)

1. At construction, `FroyoGame` calls `_loadBiomeTerrainTextures()` which async-loads all biome texture PNGs from Supabase CDN via `loadTexture()`.
2. Each loaded texture becomes a `{ width, height, data: Uint8ClampedArray }` object cached in `this._biomeTextures` (keyed by biome name).
3. At render time, `_getBiomeTextureTable(biome)` retrieves `{top, side, under, accent}` texture objects.
4. For GLB island platforms, `islandPalette` is built with `textureTop/textureSide/textureUnder` from that table.
5. `buildMeshTris(..., "island", islandPalette)` classifies each face by normal Y, sets `texture` and calls `_setTerrainUVsForTri()` for UV planar-projection.
6. In `_renderScene`, tris with `t.texture` go through `drawTexturedTri` (affine texture mapper with fog+dither), others through `drawTri`.
7. Sky ring also textured via `_getSkyPalette()` → `buildMeshTris(..., "skyRing", sky)`.

## What Remains / Next Steps

- **Verify textures appear in-browser**: Open console and look for `[texture] biome terrain tables loaded 8` (not 0). If still 0, the CDN may block CORS — check Supabase bucket CORS policy.
- **Supabase CORS policy**: The Supabase bucket must have CORS configured to allow `Access-Control-Allow-Origin: *` on the public bucket. Without it, `crossOrigin: "anonymous"` requests get blocked entirely. If textures still fail, the images may need to be fetched as blobs via the same-origin `/api/...` proxy instead.
- **Island precache + textures**: When `islandPalette.textureTop` is truthy, the code correctly skips the color-only precache and calls `buildMeshTris` live each frame for textured islands. For performance with many islands, consider baking UV coords into the precache buffer (adding a UV Float32Array alongside the existing `buf`/`colorBuf`).
- **Boot logo** (`boot_logo_front/back.glb`): Still not wired to a loading splash — listed in `MODEL_URLS` for a future session.

## Journal
- Texture pipeline was silently failing due to missing crossOrigin + bad URL resolution + missing biome entries — all three fixed this session
- Previous session: added showNotice + loadFroyoSave, wired ambient deco models (rings/mountains/buildings)
- Earlier: wired all asset CDN URLs (textures, GLBs, audio) into their respective modules

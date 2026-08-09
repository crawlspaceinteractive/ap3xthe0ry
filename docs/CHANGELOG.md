# CHANGELOG -- Froyo / Crawlspace Engine

APPEND-ONLY. Never rewrite or delete old entries; add new entries at the BOTTOM.
Each entry: date-less session tag, what changed, why, and files touched.
Purpose: full history of changes & fixes so regressions can be traced.

---

## [Session: Asset Import & Wiring]
- Wired all user asset CDN URLs (textures, GLBs, audio) into `textureatlas.js`, `islandatlas.js`, `game.js`, `audio.js`, `main.js`.

## [Session: Texture Pipeline Fix] (Phase 0 base)
- FIX: `engine/textureloader.js` -- added `img.crossOrigin = "anonymous"` before `img.src` (tainted-canvas SecurityError made every texture silently null).
- FIX: `game/game.js` `_loadBiomeTerrainTextures()` -- removed `new URL(url, import.meta.url)` wrapper (garbled absolute CDN URLs in sandboxed modules). DO NOT re-add.
- FIX: `game/textureatlas.js` -- added missing `jungle`, `golden`, `volcanic` entries to `BIOME_TEXTURES`.

## [Session: Collision Fixes] (Phase 0 base)
- FIX: `engine/geometry.js` `loadGLBMeshIfAvailable` -- HEAD preflight returned 405 and silently skipped models; removed/bypassed preflight.
- FIX: `game/physics.js` -- narrow-phase landing checks failed on flipped face normals for new island geometry; landing check adjusted.

## [Phase 1 -- Platforming Feel]
- 1.1: coyote frames (7) + jump buffer (7) + variable jump cut in `game/physics.js`.
- 1.2: camera collision avoidance in `engine/camera.js` (`updateCamera` takes `platforms`).
- 1.3: one-way platforms (`p.oneWay`/`b.oneWay`, bridge planks), steep-slope slide in `physics.js`/`world.js`.

## [Phase 2.1 -- World Editing Tools]
- Level Format v1 spec + `validateLevel()` (`tools/levelformat.js`), wired into main.js Load Map and hot-reload.
- Debug flycam (`game/flycam.js`, F key in gameplay; world freezes).
- Hot-reload (`tools/hotreload.js`, `?hotreload[=path]` polls level JSON).
- Phase 2.3 audit: affine texturing, vertex snap, Bayer dither, distance fog already in `engine/renderer.js` -- do not re-add.

## [Session: Blender Removal]
- REMOVED: `tools/blender_export.py` reduced to deprecation stub -- Blender authoring dropped by user decision; scene editor is the authoring tool. Blockbench->GLB works through the existing GLB pipeline with zero new code. DO NOT rebuild the Blender exporter.

## [Session: Phase 0–2 Sanity Check + Changelog]
- Created this append-only CHANGELOG.md; policy noted in ARCHITECTURE.md.
- VERIFIED intact: all three Phase 0 texture fixes; Phase 1.1 coyote/buffer; 1.2 camera collision called with `world.platforms` (game.js:1704); 1.3 oneWay + slope slide; 2.1 flycam F-toggle wiring, hot-reload param wiring, validateLevel on map import; blender stub in place. Flycam movement math matches engine yaw convention (yaw 0 = +Z) -- W should fly forward.
- VERIFIED: all cross-file imports/exports resolve (main.js, game/*, engine/*, tools/*). No missing exports.
- KNOWN ISSUES (flagged, not yet fixed):
  1. `game/skypalettes.js` is an orphan duplicate of `game/skypalette.js` (only the latter is imported). Delete or ignore -- drift hazard.
  2. `*_UPDATED.md` doc duplicates (README/ARCHITECTURE/DESIGN/AGENTS/CHECKPOINT_UPDATED.md) clutter root; canonical docs are the non-suffixed ones.
  3. `main.js` rAF wrapper references `tickCRT` while its import is commented out -- harmless now (`crt` is always null) but will throw if CRT is re-enabled without restoring the import.
  4. `README.md` is stale (references `models/` dir layout and has duplicated trailing headings).

## [Session: Cleanup Pass + Phase 2.2]
- CLEANUP (all 4 flagged items from previous session resolved):
  1. `game/skypalettes.js` -> deprecation stub (orphan duplicate of `skypalette.js`; nothing imported it).
  2. All 5 `*_UPDATED.md` files -> one-line "superseded" stubs pointing at canonical docs.
  3. `main.js` -- removed the rAF wrapper that referenced `tickCRT` with its import commented out (would throw if CRT re-enabled); left a NOTE comment on how to restore CRT.
  4. `README.md` rewritten -- removed stale `models/` dir references and duplicated trailing headings; documents actual layout, docs, and debug tools.
- PHASE 2.2a -- Texture atlas packing:
  - `engine/textureloader.js`: new `packTextureAtlas(urls, opts)` -- loads all unique images, shelf-packs into ONE canvas, single `getImageData`; returns Map<url, view> where each view shares the atlas buffer with `{ox, oy, stride}` sub-rect fields. Views seeded into the `loadTexture` cache.
  - `sampleTextureNearest` now honors `ox/oy/stride` (defaults 0/0/width -- standalone textures unaffected; wrap-tiling wraps in local space then offsets, so tiling stays correct).
  - `game/game.js` `_loadBiomeTerrainTextures()` packs all biome zone URLs into one atlas; per-URL `loadTexture` remains as fallback if packing fails.
- PHASE 2.2b -- UI spritesheet slicing:
  - NEW `engine/spritesheet.js`: `loadSpriteSheet(url, {cols?, rows?})` -- auto-detects sprite grid via transparent gutters (or explicit uniform grid); returns row-major sprite list, empty cells dropped. `drawSpriteFit(rd, sprite, x, y, targetH)` -- nearest blit into buf32, alpha<128 skipped, HUD-space.
  - `game/game.js`: `_loadUISprites()` slices `TEX.ui.icons` at boot into `this.uiSprites` (null on failure -> HUD text fallback).
  - `game/hud.js`: `drawHUD(rd, hud, debug, icons)` -- sprinkle/lives panels draw icon sprites (indices `ICON_SPRINKLE=0`, `ICON_LIFE=1`, adjustable constants at top) with the old "SPR"/"LVS" text as fallback.
- Phase 2 is now COMPLETE (2.1 tools, 2.2 pipeline, 2.3 already existed).
- VERIFY in-browser next session: HUD icon indices correct; terrain looks unchanged with atlas (`[atlas] packed N textures into WxH` in console); flycam W-direction (carried over).

## [Session: GLB Visual/Collision Alignment Fix]
- DIAGNOSIS: render + collision transforms for GLB models are IDENTICAL (verified islandatlas.js faces vs buildMeshTris/precacheIslandColors, and mapgen-export inlineMesh path). The perceived misalignment came from landing RESOLUTION in `game/physics.js`:
  1. The bbox-top AABB "safety net" (added in the earlier Collision Fixes session) landed the player on an invisible flat floor at the model's PEAK height across the whole island XZ footprint -- player floated mid-air above sloped surfaces, self-sustaining each frame.
  2. Landing snapped to whichever qualifying face iterated LAST in the face buffer (order-dependent), and flipped-normal acceptance let interior/underside faces win.
- FIX (`game/physics.js` GLB narrow-phase): now tracks the HIGHEST face under the player's XZ column inside the snap window (normal-sign agnostic, so flipped-normal exports still land) and resolves once after the loop; slope classification uses that face's true upward normal. The bbox-top safety net is REMOVED (do not re-add -- it was the misalignment). faceCount===0 AABB fallback kept. Wall push-out unchanged.

## [Session: Void Floors + Solid Mountains/Buildings] (entry deferred from prior session)
- FIX (`game/world.js` magnetization pass): collision AABB recompute used `* 3.5` where `* 0.5` (midpoint/half-extent) was required -> 7×-oversized invisible collision boxes centered at 7× island position ("standable floors in the void", block islands with no collision where visible). Also corrupted islandCentres -> phantom bridge/wind placement. Fixed to `0.5` (comment guards regression).
- FIX (`game/game.js`): mountains + buildings baked into collision faces via `_bakeDecoCollision` using the EXACT render transform (yaw+scale baked); registered as collision-only platforms. Buildings re-seat on fresh islands every world regeneration (were stale after reset).

## [Session: Spawn Spacing, Verticality & Aware Spawning]
- DIAGNOSIS (`game/world.js`): (1) ring radii hardcoded 24–44 / 48–72 sat INSIDE the 2×-scaled portal island footprint (half-extent ≈ 44); (2) `buildVoronoiSectors` looped `for (i = 2; ...)` so INNER_COUNT 1–2 produced ZERO inner sectors while OUTER_COUNT 20–21 crammed ~19 islands into one thin band; (3) failed rejection sampling fell back to placing at sector centre REGARDLESS of overlap -> the stacks inside the portal island.
- FIX: ring radii now derive from real portal footprint (`portalClearR + CHILD_HALF + gap`): inner ≈ 72–92, outer ≈ 106–138 (inside FOG_FAR 200). Counts rebalanced: 5–6 inner + 6–8 outer (was ~19). Sector loop starts at 0; minR only jitters UP.
- Aware spawning: shape built BEFORE sampling so overlap test uses real halfW/halfD; on failure sampler walks OUTWARD past maxR; if still blocked returns null and the island is SKIPPED (no more model stacks). MIN_SEP 10->12. Removed sector.minR mutation.
- Verticality: child base heights = portalTop + PLATFORM_HEIGHT_LUT (inner +6.4..+16, outer +12.8..+28.8 above portal top) -- world climbs upward and outward from spawn.
- BRIDGE_MAX_GAP 10S->14S to match wider neighbour distances.
- (`game/game.js`) horizon décor pushed past the new island band: mountains 110–160->180–240, land rings 130–190->200–270.

## [Session: Halved Ring Distance + 2/3 Island Size] (user-requested tuning)
- (`game/islandatlas.js`) child TARGET_HALF_W/D 22 -> 22*(2/3) ≈ 14.7 -- GLB child islands (render + prescaled collision faces) at 2/3 size. Portal island unchanged (22 × 2).
- (`game/world.js`) `CHILD_SHAPE_SCALE = 2/3` + `scaleShapeInPlace` applied to procedural shapes only (GLB shapes already scaled by atlas -- do not double-scale).
- Ring radii halved: inner 72–92 -> `portalClearR*0.92..1.14` (≈40–50), outer 106–138 -> `portalClearR*1.20..1.57` (≈53–69).
- placedIslands portal entry reduced to a 0.1× "core" -- full 44-unit bounding box would per-axis-AABB-reject the entire halved inner ring; portal clearance is enforced by ring minR (jitters only UP).
- MIN_SEP 12->8 and BRIDGE_MAX_GAP 14S->7S, both scaled proportionally with the tighter layout.

## [Session: Ring Widen ~25% + mountain_B Model Swap] (user feedback: "a bit too tight radially")
- (`game/world.js`) ring multipliers widened ~25% (≈3/4 of the pre-halving distances): inner 0.92..1.14 -> 1.15..1.42 (≈51–62), outer 1.20..1.57 -> 1.55..1.96 (≈68–86). Island size (2/3) unchanged.
- BRIDGE_MAX_GAP 7S->9S to keep bridge coverage at the wider neighbour distances.
- Horizon décor untouched -- mountains 180–240 / land rings 200–270 still clear the widened outer band (worst-case outward-walk ≈110).
- (`game/game.js`) mountain_b asset URL swapped to the new user-uploaded mountain_B_model.glb (2195d32f-…). Placement/biome logic (butte = sand) unchanged.

## [Session: mountain_B Re-swap + Lower Child Island Rings]
- (`game/game.js`) mountain_b asset URL swapped again -> 714760cb-… (prior upload had no textures, rendered invisible). Placement/biome logic unchanged.
- (`game/world.js`) child island ring heights lowered one LUT band so the inner ring is always double-jump reachable from the portal rim: inner +6.4..+16.0 -> **+3.2..+9.6**, outer +12.8..+28.8 -> **+9.6..+22.4** (ring-to-ring climb step preserved). Radial distances untouched.

## [Session: Bridge Flatsprite System] (entry deferred from prior session)
- (`engine/renderer.js`) flatsprite system: `clipNearUV()` (near-clip lerping u/v), `buildTexturedFace()` (UV-aware buildFace), `buildFlatSprite()` (oriented horizontal textured quad, double-sided, underside shaded 0.55). Alpha cutout in `drawTexturedTriangle`: texels with alpha < 128 skip depth AND color writes.
- (`game/game.js`) bridges render as textured planes instead of GLB: `_loadBridgeMesh()` -> `_loadBridgeTexture()` (rope-bridge sprite a829b7ae-…, 64×64, transparent slat gaps). `MODEL_URLS.bridge` kept but UNUSED; `_bridgeMesh/_bridgeRawLen/_bridgeScale` removed. Fallback: `buildOrientedPlank` until texture loads. Collision/one-way physics untouched.

## [Session: Connected Bridge Faces] (user request: "bridge builder needs to connect the bridge faces")
- (`game/world.js` `buildBridge`) two-pass builder: pass 1 computes plank centers + arc top heights; pass 2 gives each plank block shared edge points `_e0x/_e0y/_e0z` (rear) and `_e1x/_e1y/_e1z` (forward) -- interior edges are the exact midpoint (position + averaged top height) between neighboring planks; end planks overhang by plankL onto the islands. Collision AABBs unchanged (visuals-only).
- (`engine/renderer.js`) new `buildFlatSpriteSpan(x0,y0,z0, x1,y1,z1, halfW, color, texture, cam)` -- textured quad between two edge points, tilting with the height difference; consecutive spans sharing edges form a continuous ribbon. Same u/v convention + underside shading as `buildFlatSprite`.
- (`game/game.js`) bridge render branch prefers the connected span when `_e0x` present; legacy flat-per-plank `buildFlatSprite` and solid `buildOrientedPlank` kept as fallbacks.

## [Session: Spline-Based Bridges] (user request: "I think we should do spline based bridges")
- (`game/world.js` `buildBridge`) path is now a cubic Bézier spline: P0/P3 at the actual island top heights (bridges between islands at different heights now SLOPE between them instead of floating at the average height), control points dropped by `sag=0.8*S` (mid dip ≈0.6*S, matches old arc) and offset sideways by a random `bow` (≤ min(dist*0.25, 2.5*S)) for a gentle lateral curve. Plank centers sampled at t=i/count; edges sampled EXACTLY on the spline at t=(i±0.5)/count (identical sample shared by neighbors -- replaces the midpoint-averaging approximation). Blocks additionally carry `_p0x/_p0z/_p1x/_p1z` (spline XZ perpendicular at each edge). Collision AABBs still flat-topped per plank, top at the spline deck height; one-way physics unchanged.
- (`engine/renderer.js` `buildFlatSpriteSpan`) 4 optional trailing params `p0x,p0z,p1x,p1z` -- per-end perpendiculars so side rails stay seamless through the lateral bow; omitted -> derived from span direction (old behavior, other callers unaffected).
- (`game/game.js`) bridge render branch passes `b._p0x, b._p0z, b._p1x, b._p1z` to `buildFlatSpriteSpan`. Fallback branches untouched.

## [Session: Continuous Bridge Texture Tiling] (user report: "texture doesn't tile across the entire spline surface")
- (`game/world.js` `buildBridge`) cumulative arc length along the spline (polyline approx, ≥16 subsamples) -> each block carries continuous texture coords `_v0/_v1` (arc length / spacing, in repeat units; overhang edges extend ±plankL/spacing). Shared with neighbors like the edge points, so v never resets per span.
- (`engine/renderer.js` `buildFlatSpriteSpan`) 2 optional trailing params `v0,v1` -- per-end texture v in repeat units; omitted -> 1/0 (one sprite per span, old behavior). u inset to 0.9999 so wrap-mode u=1.0 can't sample column 0. Same inset added to `buildFlatSprite` (legacy fallback).
- (`game/game.js`) bridge texture now loaded with `wrap: true` (was clamp -- repeats couldn't tile at all); render branch passes `b._v0, b._v1`.

## [Session: Bridge Spline Collision on Map Load] (entry deferred from prior session)
- (`game/game.js`) NEW `_registerBridgeCollision()` -- on map load, each bridge plank's RENDERED ribbon quad (edge points ± spline perpendicular × `_plankW`, same corners `buildFlatSpriteSpan` draws) is baked into 2 triangles and pushed as a collision-only platform `type:"bridge_col"` (`collisionOnly:true`, `oneWay:true`, `glbModel:{faces,faceCount:2,topY}`), mirroring the ambient-deco pattern. Marks the visual plank `p._faceCollision=true`; clears stale `bridge_col` entries first. Called from all 3 world-set paths (atlas-ready gen, `_resetGame`, `loadWorldFromSceneData`). Legacy planks without `_e0x` keep their AABB.
- (`game/physics.js`) GLB face landing gained a one-way gate; wall push skipped for `p.oneWay`; legacy flat-AABB branch skips planks with `p._faceCollision` (invisible flat top no longer fights the tilted ribbon).

## [Session: Bridge Fall-Through Fix] (user report: "I keep falling through the bridges")
- ROOT CAUSE: the one-way face gate `feetNow - player.vy < faceY - 0.05` rejected faces whenever last frame's feet were >0.05 below the face at the player's NEW XZ -- but walking UPHILL on a sloped spline raises the deck by slope×speed per frame (> 0.05), so every ascending plank was skipped, the player never re-grounded, and gravity pulled them through the deck. Downhill/flat spans worked, masking it.
- FIX (`game/physics.js` one line): gate now applies only while airborne -- `p.oneWay === true && !wasGrounded && ...`. Grounded walking follows the slope via the normal snap window (±0.15/−0.8); jump-up-through-from-below unchanged (jump sets `grounded=false` before `wasGrounded` is captured, and landing already requires `vy <= 0`). Max fall 0.55 < 0.95 snap window, so no tunneling path exists.

## [Session: Bridge Sprite Crop-to-Content] (user report: "still visual gaps in the bridges -- sprite needs to be cropped to content before tiling")
- ROOT CAUSE: the bridge plank PNG has transparent padding around the artwork; with wrap-mode arc-length tiling, that padding repeats between every tile -> periodic see-through gaps along the ribbon.
- (`engine/textureloader.js`) NEW `cropToContent` option on `loadTexture()` -- scans the alpha channel for the opaque bounding box (`alphaBounds`, threshold 8, overridable via `alphaThreshold`) and re-extracts just that sub-rect, so tiles repeat artwork edge-to-edge. Cache key extended with `|crop` so cropped/uncropped variants of the same URL don't collide (atlas-seeded entries unaffected).
- (`game/game.js`) `_loadBridgeTexture()` now passes `{ wrap: true, cropToContent: true }`.

## [Session: Fewer Bridges + Stepping-Stone Platforms] (user request: "reduce their spawn amount, bridges occasionally between islands, otherwise spawn platforms")
- (`game/world.js`) bridge pass now rolls `BRIDGE_CHANCE = 0.35` per eligible island pair: hit -> `buildBridge` (unchanged); miss -> NEW `buildSteppingStones` -- a line of floating one-way hop platforms between the SAME edge anchors (supportA/supportB) the bridge would have used. Stones: spacing ≈2.1*S (inside double-jump reach), perpendicular jitter ±0.6*S, Y lerps between deck heights with a sin() mid-gap dip (0.5*S) + small noise, half-extents 0.8–1.2*S × 0.2–0.3*S, `type:"hop"`, standard block AABB collision + generic cube render path (no new renderer/physics code).

## [Session: Phase 3.1 -- Enemy AI Rewrite + Combat Bug Fixes]
- (`game/enemyai.js`) full rewrite: waypoint patrol on home island (no more random drift), line-of-sight aggro (close + same height band), contact damage with knockback, island-clamped chase, freeze->shatter mechanic (2nd breath hit OR touching a frozen enemy shatters for 1 HP; natural thaw is free), post-shatter i-frames. Boss state machine: telegraphed attacks (visible freeze-in-place tell), radial 8-shot ring below half HP, attack speed escalates across 3 damage phases.
- FIX: boss instant-kill by two breath puffs -- shatter damage is HP-based now (was bypassing damage phases).
- FIX: frozen-timer double-decrement -- `enemyai.js` is now the SINGLE owner of enemy timers (frozenT, bobPhase, spawnT, _shatterFxT); the duplicate tick in breath/game paths removed. Do not re-add timer decrements elsewhere.

## [Session: Phase 3.2 -- Hazards + Boss Defeat + SFX Rework]
- NEW `game/hazards.js`: `spawnHazards()` (every ~3rd island, cycles spike->lava->crusher, skips boss arena), `stepHazards()` (spike contact hurt kb 0.15; lava = instant death via `STATE.DEAD`, respawn flow handles it; crusher FSM wait->telegraph(20f shake)->slam->rest->rise, overlap hurt kb 0.35), `buildHazardTris()` (grey tri-prism spikes, pulsing lava pad, crusher block + dark-red danger pad).
- (`game/world.js`) imports/calls `spawnHazards`; `hazards` in world return; `spawnT: 40` on both enemy spawn sites (regular + boss) for spawn-in delay.
- (`game/game.js`) `stepHazards` in tick + `buildHazardTris` in render; boss defeat sequence -- "BOSS DOWN!" flash, death sting, big 2.5× crystal worth 50 sprinkles (`{reward:50, big:true}`; crystal reward now `c.reward ?? 10`).
- SFX rework: freeze/death sounds are flag-based (`e._frozenSfx` / `e._deathNotified`) after `stepEnemyAI` -- the old prev-state snapshot ran too early and missed breath-caused freezes/shatters entirely.

## [Session: Phase 3.3 -- Live Tunable Hooks + Spawn/Shatter FX]
- (`game/game.js`) live tunables wired into the render loop (imports were staged last session): enemy bob `+ TUN_ENEMIES.heightOffset`, mesh scales `× TUN_ENEMIES.size` (boss + regular + billboard fallbacks), yaw `+ TUN_ENEMIES.rotation`; portal `× TUN_PORTAL.size` with `hexToABGR(TUN_PORTAL.color)` / `darkenABGR(pc, 0.5)` (locked portal keeps grey); player mesh `× TUN_PLAYER.size`, yaw `+ TUN_PLAYER.rotation`, billboard fallback scaled too.
- (`game/game.js`) enemy spawn-in FX (converging ice-cube burst while `e.spawnT > 0`, cubes shrink inward and descend) + shatter FX (expanding ice-shard burst while `e._shatterFxT > 0`), both via `pushBox`, colors rgba(160,220,255)/rgba(80,140,200) matching the regular death burst.
- Phase 3 (Enemies & Hazards) COMPLETE. Needs playtest.

## [Session: Phase 4 -- Collectibles, HP/Continues, World Progression]
- NEW `game/collectibles.js`: sprinkle gem + 1-UP cherry spawn/step -- walk-over collection, per-world `SPK n/m` completion counter, "ALL SPRINKLES!" +50 bonus on clearing a world, every 100 sprinkles = extra life (single reward pipe for all sprinkle sources).
- Gem RENDER pass in `game/game.js`: gems bob/spin over islands, cherries rotate at island centers, pickup pops an expanding sparkle burst. Rotating Sprinkle GLB loader wired.
- Gradient sprinkles: NEW `"sprinkleGradient"` colorMode in `engine/geometry.js` -- hot-magenta -> cyan vertical gradient, partly self-lit so gems read against any biome terrain.
- Health system: 3 hearts (HUD pips under sprinkle counter); a hit costs one heart + 90 i-frames; player FLICKERS while invulnerable; enemies, projectiles, and hazards all respect i-frames; losing all hearts costs a life.
- Continues: 2 per run -- game over offers A: CONTINUE (same world, 5 fresh lives) or START (new game). Saved-state plumbing included.
- World progression (4.3): portal clear -> `_advanceWorld()` warps to WORLD 2, 3, 4… with cycling sky biome (ice -> grass -> sand -> bubblegum -> volcanic); sprinkles/lives/continues carry over.

## [Session: Phase 4.4 -- Per-Level Biomes via Top-Level JSON Token]
- Level JSON now carries top-level `"biome"` (terrain + sky) and optional `"skyBiome"` (sky-only override) tokens.
- (`game/game.js`) `_resolveLevelSkyBiome()` precedence chain (top-level skyBiome -> mapgen.levelSkyBiome/skyBiome -> meta.skyBiome -> top-level biome/levelBiome -> mapgen.levelBiome/biome -> world.meta.skyBiome) + `_applySkyBiome()` helper; `loadWorldFromSceneData` retints BOTH terrain and sky per level; `_resetGame` resets sky to the level's own biome (fixes stale sky after world-cycling -> game over -> new game). Unknown biome names degrade to the default palette.
- (`tools/mapgen-export.js`) `getSceneSkyBiome()`; `worldToSceneData` emits top-level `biome`/`skyBiome`; `sceneDataToWorld` carries `world.skyBiome` + `world.meta.skyBiome` so the token round-trips.
- (`tools/levelformat.js`) header spec documents both tokens; `validateLevel` biome chain extended with `data.biome`; NEW `VALID_SKY_BIOMES` (ice/grass/sand/bubblegum/volcanic/default -- sky palette set lacks jungle/golden) with warning-only `skyBiome` check.
- (`tools/scene-editor.html`) `getSceneData()` emits top-level `biome`/`skyBiome`; `loadScene` + autosave restore prefer `data.biome`/`data.skyBiome` over the legacy mapgen/meta locations.

## [Session: Froyo Hand-Painted Textures + Model-Swap Animations]
- (`engine/geometry.js`) `loadGLBMesh` now extracts the GLB's embedded texture (`_extractGLBTexture` -> CPU sampler) and returns it as `meshData.texture`.
- (`engine/geometry.js`) NEW `loadGLBAnimation(url, name, {fps=12, maxFrames=24})` -- bakes a GLB's first animation clip into flipbook frames (skinned via `boneTransform` or rigid via node transforms; matrixWorld IS applied here, unlike loadGLBMesh); normals rebuilt per frame (`_computeVertexNormals`); shared indices/uvs/colors/texture across frames. Returns `{frames, frameCount, duration, texture, animated}`.
- (`engine/geometry.js` `buildMeshTris`) NEW `"textured"` colorMode -- samples the mesh's own UVs + embedded texture, lit tint via baseColor (pass white for pure texture). Also auto-enables in DEFAULT mode for any mesh with texture+uvs (non-terrain models get textures back); terrain modes ("island"/"skyRing") untouched.
- (`game/game.js`) `MODEL_URLS.froyo_body` swapped to new hand-painted upload (db46142e-…); added `froyo_walk/jump/fall/land`. `_loadFroyoMesh` rewritten: loads all 5 via `loadGLBAnimation` (per-anim try/catch; idle required), keeps the EXACT legacy normalization math from idle frame 0, stamps the idle bbox pivot on every frame of every anim (feet stay aligned across swaps).
- (`game/game.js`) NEW `_pickFroyoFrame(player)` anim state machine: idle ↔ walk grounded; jump one-shot -> fall loop airborne; land one-shot on touchdown (early-out if moving); clock only advances during GAMEPLAY; missing anims fall back to idle. Player render passes the picked frame with colorMode `textured` (white base; HIT = red tint) or legacy `froyo` if untextured.

## [Session: Per-Mesh GLB Textures] (user report: "bowl texture loads but the rest of the meshes aren't loading their textures")
- (`engine/geometry.js`) ROOT CAUSE: `_extractGLBTexture` returned only the FIRST texture found across all meshes, so every merged mesh sampled the bowl texture (all-brown Froyo). Replaced with `_extractGLBTexturesPerMesh` (one CPU sampler per mesh, deduped by source image) + `_buildTriTextures` (per-triangle texture lookup aligned to the merged index buffer). `loadGLBMesh` and `loadGLBAnimation` now return `triTextures` alongside `texture` (first-found, kept for truthiness checks); every baked animation frame carries `triTextures`.
- (`engine/geometry.js` `buildMeshTris`) textured branch now picks `triTextures[t]` per triangle; untextured segments in an otherwise-textured model fall back to vertex colors / base color instead of sampling the wrong map.
- (`game/game.js`) Froyo load log now prints `meshTextures: N` (distinct textures found) for playtest verification.
- (`game/tunables.js`) Synced tune-mode slider values: player.size 1.0->3, player.rotation 0->90 (creator fixed the facing-left issue via yaw offset slider).

## 2026-08-08 -- Smallfont slash + title "1"
- engine/asseturls.js: added slash.png and title1.png CDN mappings.
- racer/hudfont.js: "/" and "1" added to smallfont body set (BODY_FILES slash/title1); loadHudFonts digit merge no longer overwrites existing body glyphs.

## Session -- Intro polish + best-lap red fix (2026-08-08)
- Warning card text now renders in the bigfont (black, auto-fit, 4 lines).
- AP3X swoop blink synced to the arc: visible through the swoop, blinks out at
  the end of the arc, reappears at the top as the motion restarts; final pass
  stays lit so the title lands.
- THE0RY trail reworked: same-size shifted after-images (velocity-driven
  spacing, collapsing as it settles) + a horizontally stretched smear pass
  anchored at the word's left edge.
- Best-lap HUD line: once a best exists the WHOLE line (numbers included)
  renders red -- routed through the body-font path so blitGlyph tints the
  digits instead of blitting baked steel. (Lap detection itself verified OK
  via node sim: bestMs sets on first crossing.)

## [Session: Racer GLB URL Fix]
- FIX: `engine/asseturls.js` -- `ahura.glb` mapped to Star-only proxy `/api/games/.../assets/3a743297-...` which 404s on local hosts, so the car mesh silently fell back to procedural. Re-mapped to the flat CDN bucket UUID `3a743297-6d88-4481-90c2-3a2221e42cf3.glb` (verified byte-identical to local `assets/ahura.glb`, 200 OK). Vehicle mesh now resolves and loads correctly.

## [Session: Asset Tree Restructure -- mirror GOLD layout]
- Restructured flat `assets/` into the GOLD-standard nested tree: `assets/2D/{sprites,textures,ui/fonts/{bigfont,smallfont,numbers/{speedometer,position}}}`, `assets/3D/{maps,models}`, `assets/audio/{sounds,soundtrack}`. 163 files, 0 orphans vs the asseturls.js registry (checked both directions).
- Kept flat CDN basenames inside nested folders (bigfont `A_.png`..`Z_.png`, position `0.png`..`9.png` big, speedometer `small0.png`..`small9.png` small, etc.) so `assetUrl()` basename lookups keep resolving to the flat Supabase bucket.
- Code references updated to nested paths in `racer/racergame.js` (rock/grass/ahura.glb/headlight_flare/lightray/smoke_anim), `racer/racersound.js` (22-track soundtrack + 6 sfx), `racer/hudfont.js` (DIR_SPEED/DIR_POS/DIR_BIG/DIR_BODY), `racer/sky.js` (3 fuji layers), `racer/scenery.js` (pine_sway.gif), `game/textureatlas.js` (10 biome textures), `engine/audio.js` (BGM). `assetUrl()` takes the full nested path now (basename is what maps).
- Moved project docs into `docs/` (AGENTS/ARCHITECTURE/CHANGELOG/DESIGN/README/checkpoint/latest) mirroring GOLD, copied `docs/roadmap/` from GOLD, added `.gitattributes` (`* text=auto`).
- Verified: nested file names ↔ shim keys both ways (163/163), directory structure matches GOLD's `assets/` tree exactly.

## [Session: Pause Menu Overhaul + 1s Rev Fade + Docs Sweep]
- Pause menu moved into `MenuController` (`racer/menus.js`): new `"PAUSE"` mode via `menu.enterPause(inp)`; rows RESUME / SFX VOL / MUSIC VOL / FULLSCREEN / KEY BINDINGS / QUIT TO MENU. `tick()` returns "RESUME"/"QUIT"; START or B/Backspace anywhere in the pause root resumes. BINDINGS submenu shared via `_bindReturn` ("OPTIONS" or "PAUSE"); fullscreen toggle reused. `_drawPause` mirrors `_drawOptions` (px=24, sliders SW=150, fits the 240px-tall framebuffer).
- `racer/racergame.js`: RACE->PAUSE calls `menu.enterPause(input)` + `racerSound.duck()`. Pause ticks the menu; "QUIT" rebuilds vehicle + chase cam, clears particles, resets lap timer, returns to MENU (music keeps playing, intended). Removed `_tickPause`, pause-row fields, `drawPause` import; PAUSE branches render via `this.menu.draw(...)` over the race HUD.
- `racer/racersound.js` `rev()`: one-shot on title START -- plays ~1s then fades to 0 over ~0.4s in 12 steps and stops the handle.
- `racer/racerhud.js`: legacy `drawPause` / `drawTitle` / `drawLoading` kept as reusable draw helpers (unused by the live loop, which routes pause through `MenuController` and title through the title system, but retained for future screens).
- `racer/menus.js`: ABOUT menu now fetches `docs/README.md` + `docs/CHANGELOG.md` (were at repo root pre-restructure).
- Docs rewritten out of Froyo for AP3X THE0RY: `docs/README.md` (racer overview, boot flow, controls, layout; notes engine/ is shared and game/ is the legacy platformer), `docs/DESIGN.md` (racer concept/core mechanic/art style + racer system decisions; Froyo decisions demoted to a legacy section), `docs/ARCHITECTURE.md` (racer/ file map for all 14 modules, engine map, legacy rant marker, render pipeline). Kept lines under 48 chars for the in-game ABOUT page.

## [Session: Level Lifecycle + Checkered Sky]
- `racer/levels.js` (new): level registry -- each entry has id/name/desc + a `build()` that returns a track. AHURA RING = the current ring (track.js defaults). Future tracks drop in by adding a `build: () => buildTrack({ cp, halfWidth, sampleSpace })` entry.
- `racer/track.js` `buildTrack(def)`: now accepts an optional def ({ cp, halfWidth, sampleSpace }) so levels can provide their own control points/road metrics; no-arg callers unchanged.
- `racer/scenery.js`: split load -- `load()` fetches the pine texture once, `place(track)` positions trees for the current level, `reset()` (kept) drops the tree list on unload.
- `racer/racergame.js` level lifecycle: `loadLevel(idx)` unloads old level + builds track/vehicle/cam, places scenery once assets ready, resets lap timer & camera; `unloadLevel()` clears particles, lap timer, place, and ducks race loops. PLAY uses loadLevel; QUIT (from pause) now does a real teardown (unloadLevel) then rebuilds the menu backdrop level and transitions to MENU.
- `engine/renderer.js` skid swap: `clearSky` now fills a large-cell bicolour checkerboard instead of the gradient/star/cloud procedural sky. Pattern is yaw-driven (`yawShift = cameraYaw * 11`), so in the main menu, where the racerGame orbits the track center, the checker streams behind the header -- an animated skyline. Fuji 3-layer parallax (racer/sky.js) blits on top unchanged; confirmed as the sky-system base for future per-track skies.

## [Session: Enter is a Confirm Key Everywhere]
- FIX (single source of truth): `racer/menus.js` `_tickPause` treated Enter/START as an instant resume from anywhere in the pause root -- the only menu where confirm and the START flag diverged. Per "Enter is confirmation always," replaced `inp.justPressed(BTN_FLAGS.START) || e.back -> "RESUME"` with the standard `e.confirm` row path: Enter/START/Space confirm whatever row is highlighted (RESUME row 0 still resumes on Enter; QUIT/FULLSCREEN/KEY BINDINGS now need an explicit tap on their row). B/Backspace remains the only "back" key.
- Files: `racer/menus.js` (`_tickPause`); docs session entry. `node --check` passed.

## [Session: Menu-Transition Loading Screen]
- New `racer/loading.js`: shared `drawLoadingBar(rd, fonts, p)` — the single source of truth for the orange "LOADING" progress bar (white-outline frame + orange fill, smallfont label with bitmap fallback). Genre `titleintro.js` LOAD phase now calls it, so the bin intro screen and every main-menu transition are pixel-identical.
- `racer/racergame.js`: new `LOADING` state entered when QUIT leaves a course for the main menu. The just-left track's scene stays parked (the level is NOT torn down yet); the state orbits the sky layers over the checker backdrop and fills the identical loading bar for `LOADING_T` (180 frames, same LOAD_T visual pace), then performs the real `unloadLevel`/`loadLevel` teardown and settles into MENU. So leaving a course runs an intro-style loading screen that shows the sky textures of the last track visited as its background; the boot intro still uses its own LOAD phase (identical bar, differs only in background).
- Files: `racer/loading.js` (new), `racer/titleintro.js`, `racer/racergame.js` (`LOADING` state, `_loadingT` counter), docs. `node --check` passed on all touched files.

## [Session: Boot Cinematic — Dev + Platform Cold Open]
- New `racer/intro.js` (user-provided): DOM-overlay cold open that plays BEFORE the boot warning card. Splash (DEEPSMOKE on black, waits for any input — also the audio-unlock gesture) → cinematic reel → reveal. `CINEMATICS` array is the extension point for future full-screen steps; each gets `{ stage, audio, sleep, fadeOut, shake, mkImg, skipped }`. Any key/tap after the splash fast-forwards the whole reel to the reveal.
- Cinematic 1 (DEV): headlight lightray flickers like a failing arc lamp, then the dev logo punches from scale 6 into center with a decaying screen shake; impact sound = the existing `crash` SFX buffer (`audio.play('crash')`, the same one racerSound preloads for wall hits).
- Cinematic 2 (PLATFORM): "BUILT WITH" → STAR logo fades in → "STAR" wordmark.
- Asset URLs wired via `assetUrl()`: `LIGHTRAY_URL` = `assets/2D/sprites/lightray.png` (headlight sprite), `DEVLOGO_URL` = `assets/2D/ui/devLOGO.png`, `STARLOGO_URL` = `assets/2D/ui/StarLogoWithTransparentBg512x512.png`.
- `racer/racergame.js`: added `warmup()` — starts asset loading (car GLB, textures, fonts, sky, sfx) with no render loop, guarded by `_loaded` so `start()` doesn't reload. `start()` keeps its own `_loaded` guard too.
- `main.js`: boot order is now `new RacerGame` → `game.warmup()` (assets preload behind the overlay) → `runIntro({ root, audio, onReveal: () => game.start() })`. `audio` is the same `engine/sdk-audio.js` singleton racerSound uses, so the crash impact buffer is shared. The reveal lifts the black overlay off the game's first frame (boot warning card) with no loading-bar flash.
- Files: `racer/intro.js` (new), `racer/racergame.js` (`warmup`, `_loaded`), `main.js`. `node --check` passed on all three.

## [Session: Intro Trim — No Splash, Non-Skippable]
- `racer/intro.js`: dropped the borrowed DEEPSMOKE splash ("PRESS ANY KEY"/tap-to-begin) entirely — removed `showSplash`, `waitForInput`, gamepad poll, and the whole skip/fast-forward machinery (`skip`, `skipped()`, `doSkip` listeners, splash fade-out). The reel now STARTS at cinematic 1 (dev logo smash) and runs back-to-back.
- The intro is now NOT skippable on purpose: it runs on a fixed clock so the warmup() asset preload actually has time to fetch the car GLB, textures, fonts, sky, and sfx before the reveal drops into the game. Sleep/shake/punch loops no longer fast-forward and the impact `crash` always plays.
- `ctx` passed to cinematics is now `{ stage, audio, sleep, fadeOut, shake, mkImg }` (no `skipped`).
- Files: `racer/intro.js`. `node --check` passed; verified no `skip`/splash identifiers remain in the file.

## [Session: Intro Uses the Big Font]
- The platform cinematic's "BUILT WITH" and "STAR" words are now rendered with the game's OWN bigfont sprites (`assets/2D/ui/fonts/bigfont/A_.png`…`Z_.png`, 32x64 cells) instead of DOM text. New helpers in `racer/intro.js`: `loadBigGlyph` (loads a letter with `crossOrigin` so the external CDN pobytes can be read), `getBigGlyph` (per-letter cache), `bigWordCanvas` (rasterizes a word into a canvas at a target height), `bigWordImg` (canvas → image).
- Tracking matches the in-game titles exactly: each glyph's content box is measured (`minX`/`adv`, the same alpha-scan rule as `racer/hudfont.js` `withMetrics`) and letters are blitted at `adv * scale` with a 2px gap (`drawBigText` default) and space = half the letter height. Nearest-neighbour (`imageSmoothingEnabled = false`) so the letters stay crisp.
- The words replace the previous CSS-text placeholders (`#pc-built`, `#pc-star`); the STAR wordmark image and fade choreography are unchanged. Font sizes are viewport-height derived (`BUILT WITH` ≈ 5.5vh, `STAR` ≈ 3.5vh).
- The asset-cache warm loop now also prefetches the bigfont glyphs used by the reel (`BUILT WITH STAR`), so the rasterization never flashes mid-cinematic.
- Files: `racer/intro.js`. `node --check` passed; glyph metrics verified against the actual PNGs.

## [Session: Intro Audio Warmup Beat]
- Added a 1s beat of black at the START of `devCinematic` in `racer/intro.js` (the old 350ms hold). The crash impact (`audio.play('crash')`) was firing before the remote sfx buffer had finished fetching+decoding, so `play()` no-op'd and the sound surfaced later (on the loading screen). The 1s gap lets the warmup-triggered `audio.preload(SFX)` land the crash buffer before the punch lands.
- Files: `racer/intro.js`. `node --check` passed.

## [Session: Gate Crash on Buffer Readiness]
- Stopped guessing with a fixed delay. The bigfont glyph fetches (added in the "Intro Uses the Big Font" session) compete with the crash mp3 for the browser's connection pool, so the fixed 1s beat could still miss: `audio.play('crash')` no-op'd and the sound surfaced on the loading screen instead of the punch.
- `racer/intro.js` now preloads the crash buffer itself (idempotent — same `audio.preload` id racerSound uses so it shares the cached buffer) and holds a `crashReady` promise. `devCinematic` AWAITS that promise before starting the logo punch, so the impact sound is guaranteed to fire exactly when the logo slams in — never early, never queued behind the glyph fetches. A late buffer just holds on the light/flicker a moment longer.
- Files: `racer/intro.js`. `node --check` passed.

## [Session: Repo Reorg — Mend Moved Asset Paths]
- Repo assets reorganized to prepend variants in subfolders. All live-game friendly paths mended to match the new layout (the basename→CDN mapping in `engine/asseturls.js` is unchanged, so runtime asset resolution is unaffected — the friendly paths now match the index.html on-disk structure):
  - Base terrain textures: `assets/2D/textures/{name}.png` → `assets/2D/textures/base/{name}.png` — `game/textureatlas.js` (all `TEX.terrain`), `racer/racergame.js` (rock, grass).
  - Skies: `assets/2D/textures/fuji_sky_layer_*.png` → `assets/2D/textures/skies/fuji/fuji_sky_layer_*.png` — `racer/sky.js` LAYER_DEFS.
  - Intro UI: `assets/2D/ui/{{devLOGO,StarLogoWithTransparentBg512x512}}.png` → `assets/2D/ui/intro/` — `racer/intro.js` (URLs + header docs).
  - FX sprites: `assets/2D/sprites/{headlight_flare,lightray,smoke_anim}.png` → `assets/2D/sprites/fx/` — `racer/racergame.js`, `racer/intro.js`.
  - Scenery: `assets/2D/sprites/pine_sway.gif` → `assets/2D/sprites/trees/` — `racer/scenery.js`.
  - Updated `engine/asseturls.js` header-comment example (`base/rock.png`).
- Files: `game/textureatlas.js`, `racer/racergame.js`, `racer/scenery.js`, `racer/sky.js`, `racer/intro.js`, `engine/asseturls.js`. All `node --check` passed. `[GOLD]` archive and pre-reorg CHANGELOG entries intentionally untouched.

## [Session: Invisible Audio-Unlock for the Boot Reel]
- ROOT CAUSE of "crash plays way too late / in titleintro": the browser suspends the AudioContext until the FIRST user gesture (autoplay policy). The boot reel is non-skippable by design, so `audio.play('crash')` fired while the context was still suspended — the buffer was queued inaudibly and only surfaced when the player first pressed a key (which lands in the title intro / loading screen, a different module than the intro).
- The old "PRESS ANY KEY" splash used to BE that gesture; removing it (non-skippable reel) removed the unlock. Fixed without bringing back any UI or skippability:
  - `engine/sdk-audio.js`: new `audio.unlock()` — resumes the context if suspended, resolves true once it's running.
  - `racer/intro.js`: an INVISIBLE one-time trigger traps the first keydown/pointerdown/touchstart/mousedown on `window` (no UI, does NOT skip the reel) and calls `audio.unlock()`. A `firstUnlock` promise resolves on that gesture; `devCinematic` AWAITS it (raced with a 3.5s cap so a passive viewer can't hang the reel) BEFORE the beat/flicker, guaranteeing the AudioContext is running by the time the logo punches and the crash fires.
- Files: `engine/sdk-audio.js`, `racer/intro.js`. `node --check` passed on both.

## [Session: Play Submenu / Game-Mode Selection]
- PLAY in the main menu now opens a submenu (`GAMEMODES`) instead of starting the race directly. Options: SINGLE RACE, TIME ATTACK, HEAD2HEAD.
- TIME ATTACK is the current build's mode — confirm on it returns "PLAY" (unchanged race-start path). SINGLE RACE and HEAD2HEAD are stubs for later; confirming them enters a new `NOTICE` screen showing "THIS GAME MODE IS NOT AVAILABLE IN THIS DEMO."
- The NOTICE screen is a dead-end with no state side-effects: back (B/Backspace) or confirm returns to the PLAY submenu with `gamemodeRow` intact.
- Back from GAMEMODES returns to MAIN. `reset()` is unchanged — the title-intro end and quit-race paths still land on the root menu.
- Files: `racer/menus.js`. `node --check` passed.

## [Session: Esc Is the Universal Back Key]
- Esc was previously baked into the fixed key map as `Escape → BTN_FLAGS.START` (`engine/input.js`), so it fired as a confirm/advance (and pause) everywhere — the opposite of a back key.
- ROOT CAUSE fix: removed `Escape` from `FIXED_KEY_MAP` in `engine/input.js` so it no longer double-issues as a confirm/START. Escape is now handled explicitly as a BACK edge via `keyJustPressed("Escape")` in the menu controller's `_edges()` — so it goes back/resumes in every menu sub-state (MAIN, GAMEMODES, NOTICE, CONTROLS, OPTIONS, BINDINGS, ABOUT, PAUSE), and never confirms.
- `racer/racergame.js`: the race state still opens the pause on `startPressed`, and Escape is now ALSO an explicit pause trigger (`keyJustPressed("Escape")`) since it no longer flows through START. In the pause menu, Escape resumes the race (BACK → "RESUME").
- Hint strings updated from `K/BKSP:BACK` to `ESC:BACK` throughout the menus.
- Files: `engine/input.js`, `racer/menus.js`, `racer/racergame.js`. `node --check` passed on all. The `SPC:BACK` hint in `racerhud.js` is inside the archive-only `drawPause` — untouched.

## [Session: Course / Track Loading (step 1)]
- KEEP: `game/` legacy Froyo stays on purpose (mine later / port into engine
  feature list). Noted in ARCHITECTURE, DESIGN, README.
- `racer/track.js` `buildTrack`: accepts polar `[a,r,y]` OR XYZ `{x,y,z}`
  control points; optional per-point `hw`/`bank` on samples; AHURA west
  ramp only when `applyDefaultRamp: true`.
- NEW `racer/trackload.js`: `parseSplineTrack` / `loadSplineTrack` for
  spline-editor JSON (`kind: "spline-track"`).
- `racer/levels.js` is the level list / course catalog: AHURA RING +
  test_track (`assets/3D/maps/test_track.json`); helpers `findLevelIndex`,
  `levelCount`, `resolveLevelTrack`. Future course select scrolls LEVELS.
- `racer/racergame.js`: async `loadLevel` via levels list; `?level=` id or
  index for authoring until course-select UI (step 2).
- Course-select menu, banked ribbon, objects/procgen scenery: deferred.

## [Session: Course Select (step 2)]
- `racer/menus.js`: new COURSES mode — after TIME ATTACK, scroll LEVELS
  (name + desc + N/M index). Confirm sets `selectedLevelIdx` and returns
  "PLAY"; Esc backs to GAMEMODES. Left/right also scroll.
- `racer/racergame.js`: PLAY applies `menu.selectedLevelIdx` then
  `_beginRace()` / async `loadLevel`. Menu seeded from `?level=` / default.
- `racer/levels.js`: catalog comment updated — COURSES scrolls LEVELS.
- Banked ribbon + objects/procgen still deferred.

## [Session: Course Elevation + Map Scan + Iso Preview]
- ROOT: `hill_test.json` (y −24.7..30) lived under assets/3D/maps/ but was
  never on LEVELS; course select also never swapped the backdrop track, so
  elevation never appeared. Banked ribbon edges were flat (editor uses bank).
- NEW `assets/3D/maps/manifest.json` — `hydrateLevels()` scans it into LEVELS
  at boot (AHURA stays #0). Add a map = drop JSON + list it in the manifest.
- `racer/trackrender.js`: road/rumble/walls/caps use banked `edgePt` (same
  math as spline-editor ribbonCorners) so elevation+bank lift the ribbon.
- COURSES: live-loads the highlighted course as the menu backdrop
  (`loadLevel(idx,{preview:true})`, quiet audio) and uses an iso-style
  orbit cam (pitch 38°, farther/higher) so hills read clearly.
- Files: levels.js, racergame.js, trackrender.js, manifest.json, docs.

## [Session: Ribbon Parity — banked ground + edge bevel + bank-aware walls]
- GOAL: the racer's road ribbon (and ground query) now matches the spline
  editor's banked geometry 1:1 — visuals and collision agree on camber.
- `racer/track.js` `queryTrack`: `groundY` is now `cy + lerp(sin(bankA),
  sin(bankB), t) * lat` — lerping the SINES (not sin of the lerped angle) so
  the query rides the editor's bilinear deck exactly; the vehicle now sits on
  the camber instead of the flat centerline. Returned object gains `bank`
  (degrees, lerped). Callers (vehicle.js, chasecam.js, laptimer.js) unchanged —
  they already consumed `q.groundY`.
- `racer/trackrender.js`:
  - `edgePt` exported; new `sampleUp(sample)` returns the deck up-normal
    `(fz·sb, cb, −fx·sb)` (bank 0 → (0,1,0)).
  - Walls: tops now lift along `sampleUp · WALL_H` (banked surface normal)
    instead of world +Y, so walls hug a cambered deck (flat tracks identical).
  - New inner edge bevel: darker strip per side between 0.62×hw and 0.9×hw
    (editor `edgeCorner` f range), `shadeFace(ROAD_TINT, 0.55)`, `avgZ −= 0.04`
    (sits above the road, below the start checkers), gated by the same
    `!gap && d2 < RUMBLE_DIST_SQ` as the rumble.
- NEW `tools/ribbon-smoke.js` (`node tools/ribbon-smoke.js`, exits non-zero on
  fail): asserts edgePt ≡ editor edgeCorner (f ∈ {0.62, 0.9, 1.0}, both sides),
  sampleUp orthogonality/up.y == cos(bank), queryTrack groundY at lat=±hw/0
  equals editor corner heights, mid-segment/straight-segment queries equal the
  bilinear deck reconstructed from the four rendered corner heights, and a
  flat-track regression (bank 0 → groundY == y, edgePt.y == s.y, up=(0,1,0)).
- Files: `racer/track.js`, `racer/trackrender.js`, `tools/ribbon-smoke.js`.
  `node --check` passed on all; smoke test passes. PLAYTEST note: verify
  `?level=hill-test` (regression); to SEE bank, temporarily bank an AHURA CP
  or drop a banked export (both shipped maps are bank 0).
- PLAYTEST map: NEW `assets/3D/maps/bank_test.track.json` (spline-editor export,
  bank 14°–18°, hw 12.5) registered in `assets/3D/maps/manifest.json` as
  "BANK TEST" — selectable in COURSES (or `?level=bank-test`) to see the car
  sit on the camber and walls follow the deck. Stale `latest.md` and
  `docs/checkpoint.md` removed.

- FIX (ribbon parity, unreleased): the edge bevel was a flat strip coplanar
  with the road (only `avgZ −= 0.04` separating it) → z-fighting on banked
  sections. Now the bevel is a real sloped lip: inner edge at deck height
  (0.62×hw), outer edge lifted `BEVEL_LIFT = 0.2` along the deck normal
  (`sampleUp`) at 0.9×hw, so it reads as a curb/chamfer and is never coplanar.
  `BEVEL_BIAS` removed; `BEVEL_LIFT` added. `node --check` and
  `tools/ribbon-smoke.js` pass.

- FIX (ribbon parity, unreleased): removed the rumble strips and the flat road
  sliver between bank and wall. The bank (sloped edge lip) now runs from
  `BEVEL_IN×hw` all the way to the track edge (`hw`) with `BEVEL_LIFT` at its
  outer edge, and the wall starts exactly at the end of the bank (base = the
  bank's raised outer edge, top +WALL_H along the deck normal). This stops
  high-speed tri culling from showing the road deck underneath and removes the
  road-texture sliver visible between the old bank end and the wall. Rumble
  quads + `RUMBLE_*` constants removed; grass apron base moved from
  `hw+RUMBLE_W` to `hw`. `node --check`, `tools/ribbon-smoke.js`, and a
  buildTrackTris pass on all three maps pass.

- FIX/CHANGE (ribbon parity, unreleased): spline meshes are now rendered as
  whole QUAD units instead of per-triangle splits. New `buildPoly()` in
  `engine/renderer.js` clips + projects a quad and returns a single sortable
  unit `{ verts: [n], color, avgZ, texture? }` (one centroid avgZ; a
  near-plane-clipped quad may become a 5- or 3-point polygon). The draw loop
  in `racer/racergame.js` fans each unit into triangles at raster time. The
  painter's pass now sorts whole spline quads coherently, so the road no longer
  shows through the bank/wall at high speed (per-triangle avgZ made the two
  halves of a quad sort independently and leak the deck under the edge).
  `buildTrackTris` emits quads for road, checkers, bank, rumble, wall, grass,
  ground, and gap caps. `buildFace`/`buildTexturedFace` are unchanged for other
  geometry (scenery, cubes, vehicles).
- FIX/CHANGE (ribbon parity, unreleased): rumble strips are back — one quad per
  side between the bank and the wall (bank ends at the track edge `hw`, rumble
  sits `hw..hw+RUMBLE_W`, wall base at `hw+RUMBLE_W`, grass apron resumes
  there). Rumble quads are emitted as single units and gated by
  `d2 < RUMBLE_DIST_SQ` as before. `node --check` + `tools/ribbon-smoke.js`
  pass; buildTrackTris emits all-quad units on all three maps.

- CHANGE (ribbon parity, unreleased): the road now stops at the start of the
  bank — the road deck spans only ±(BEVEL_IN×hw) instead of ±hw, so the road
  never runs under the bank; the start-line checkers follow the narrower road.
  The bank + rumble band (BEVEL_IN×hw .. hw+RUMBLE_W) gets a dirt ground plane
  underneath, dropped 0.15 below deck (matching the grass apron inner edge) so
  the sloped bank never shows sky/void from low or side angles. Physics is
  untouched (queryTrack still uses full hw), so the car can still ride the
  bank. `node --check`, `tools/ribbon-smoke.js`, and quad-build checks on all
  three maps at multiple yaws pass.

- CHANGE (off-road, unreleased): track walls are now randomly solid per run —
  `buildTrack` seeds run-length wall flags (`wallSolidSeed`, default
  `20260808` via exported `mulberry32`; `WALL_SOLID_CHANCE 0.7`,
  `WALL_RUN_MIN 3`, `WALL_RUN_LEN 6`) so gaps are long enough to drive
  through, and ramp/gap samples are always open. `cfg.wallSolid: "all"`
  restores always-solid walls. `queryTrack` returns `wallSolid` (true only
  when both flanking samples are solid) and `trackrender.js` skips wall quads
  on open runs, so the physics boundary always matches the drawn wall.

- CHANGE (off-road, unreleased): beyond the road edge the car drives on an
  off-road plain (`track.offroadY = minY − 0.4`, rendered flat so physics and
  graphics share the same surface). Off-road: top speed ×0.3, per-frame drag
  ×0.97, lateral grip ×1.4 (heavier understeer), drift charge disabled, and a
  new `OFF ROAD` HUD indicator + dirt kick-up particles. Wall collision now
  requires `onRoadLat && nearDeck && q.wallSolid`, so gaps are passable and
  leaving the deck is what actually punishes you. Fall-off respawn gained an
  off-road clause: falling farther than `fallKillDepth` below the LOCAL deck
  plane respawns (so cliff/bridge falls on elevation courses return you to the
  road instead of stranding the car on the distant flat plain).

- CHANGE (off-road, unreleased): new `racer/tirestacks.js` places destructible
  tire-stack barriers on open (non-solid) wall runs, deterministically seeded
  by arc distance. Each stack is a 3-tire column of quad units (`buildPoly`,
  side quads + shaded caps); the car is never blocked — overlapping the stack
  knocks it aside (lean tumble + pop), it slides, and falls to the off-road
   plain. Stepped in `racergame._step`, rendered with `buildTireStackTris` in
   the shared painter pass, torn down on `unloadLevel`. `node --check` and
   `tools/ribbon-smoke.js` (extended: wall solidity determinism, offroadY,
   tire-stack placement determinism) pass.

- CHANGE (off-road, unreleased): the off-road plain is no longer a flat drop —
   grass now slopes smoothly from the road edge down to `track.offroadY` so
   drivers who leave the track can drive back onto it instead of being stuck
   under the deck. Track building exports the shared constants `RUMBLE_W`
   (0.9), `TRANS_MIN_W` (16), and `TRANS_SLOPE` (0.35, ≈19° max gradient) and
   stores `track.transW = max(TRANS_MIN_W, (maxEdge − (minY − OFFROAD_DROP)) /
   TRANS_SLOPE)`, where `maxEdge` is the highest road edge including bank lift
   `abs(sin(bank))·(hw + RUMBLE_W)` — so even steep banked sections keep the
   ramp climbable. The new exported `track.js` helper `groundHeightAt(track,
   q)` returns the deck plane inside ±(hw+RUMBLE_W) and, beyond, a smoothstep
   `u²(3−2u)` ramp to `offroadY`; the renderer's grass apron is replaced by a
   matching ramp quad (inner edge at `hw+RUMBLE_W`, outer at
   `hw+RUMBLE_W+transW`, `offroadY`) so the drawn slope is exactly drivable.
   `vehicle.js` rides that surface via `groundHeightAt` (still using the flat
   floor when under a bridge), and the earlier fall-off "local deck drop"
   respawn clause is removed since the ramp eliminates the stranded-cliff
   case. Verified with `node --check`, `tools/ribbon-smoke.js` section [7]
   (deck → monotonic slope → floor, max drop 0.175 per 0.5 unit, `transW ≥
   16`), a hill-test drive-off/drive-back simulation (rides the ramp from deck
   height, climbs from the −27.87 floor back to deck level), and quad-build
   checks on all four maps at 4 yaws.

- CHANGE (HUD, unreleased): the racing minimap now auto-scales to the track
   instead of assuming the old fixed `MM_RANGE` (140, which clipped any course
   wider than ~126 half-span — e.g. BANK TEST's 488-unit span). `drawMinimap`
   derives its range from the track samples (`minimapRange`: max |x|/|z| across
   samples, padded ×1.15 so the outline keeps a small margin) and maps the
   spline, start tick, driver dot and heading nub with that scale, so large
   courses zoom out to fit and small ones zoom in to use the whole box.

- CHANGE (menu/audio, unreleased): the main menu now plays the menu theme —
   22. U-Turn (the last soundtrack entry), looped — instead of silence.
   `racerSound.playMenuMusic()` stops any current song and loops U-Turn with a
   fade-in; it runs on every entry into MENU (boot + quitting a race) and
   disables the race shuffle watchdog while the menu owns the music. Selecting
   a course fades the theme out (`fadeOutMusic(450)` on PLAY) and entering
   RACE hands the music back to the 22-track shuffle via `startRace()` —
   `_nextTrack()` now stops any looping menu handle before the shuffled track
   starts, so the two never overlap. U-Turn stays out of the shuffle.

- CHANGE (menu/loading, unreleased): entering a course from the menu now runs
   a quick loading screen — the map-select globe (same `drawGlobePlaceholder`
   + crosshair look as COURSES) with the orange LOADING bar on top
   (`RACE_LOADING_T = 90` frames ≈ 1.5s). `RacerGame` tracks the loading
   destination via `_loadingTo` ("RACE" on PLAY, "MENU" on QUIT); the RACE
   path resolves the level then enters RACE + `startRace()`, and a race-start
   failure falls back to MENU with the theme restored. The course→menu loading
   screen (last track's sky) is unchanged.

- CHANGE (boot intro, unreleased): the WARN card now uses the new
   `assets/2D/ui/intro/WARNING.png` as its full-frame background instead of the
   solid orange fill. The 640×480 art (2× the software frame, same 4:3) is
   downscaled once to the 320×240 frame with `imageSmoothingEnabled = false`
   and blitted straight into the renderer buffer each WARN frame, so it is
   fitted to the display exactly (no cropping) and passes through the normal
   upscale + dither in `present()`. It loads in parallel at boot (the
   `racer/intro.js` reel covers the latency) and the WARN phase falls back to
   the orange card until the image lands.

- CHANGE (driving feel, unreleased): smoother downhill riding on steep grades
   and ramps — three fixes in `racer/vehicle.js` + `racer/chasecam.js`.
   (1) Grounded descents now EASE toward the ground (exponential lerp,
   `groundFollow` 0.75, climbs still tight at `groundFollowUp` 0.95) instead of
   hard-snapping each frame, so per-segment slope steps no longer turn into y
   micro-jumps; the launch gate was raised (`launchDropGate` 1 → 3) and now
   reads the ground's OWN per-frame drop (`prevGroundY − targetY`) rather than
   the car's lagged position, so continuous steep descents (hill-test deck
   drops ~2.6 u/frame at top speed) are ridden smoothly instead of toggling
   airborne/landed. (2) The car's visual pitch target (from the actual eased
   vertical motion) is EMA-smoothed (`pitchTgtSmooth` 0.4, clamped ±60°) before
   the 0.25 follow-lerp, killing the nose teeter-totter at slope transitions —
   max per-frame pitch delta roughly halved, mean delta ~2× lower on a 12-seg
   sustained hill-test descent. (3) `chasecam.js` floor clamp now rides the
   actual rendered surface via `groundHeightAt` (banked deck → grass ramp →
   flat floor) instead of the invisible deck-plane extension, which had forced
   the camera up on the ramp band and snapped it down past `|lat| = hw+2.5`;
   and camera view pitch is smoothed (`CAM.pitchRate` 0.3) so the skybox stops
   jumping on steep descents and ramp→floor transitions (max per-frame camera
   pitch delta ~3× smaller). All new values are live tunables. Verified with
   `node --check`, `tools/ribbon-smoke.js`, and downhill simulations on
   hill-test/bank-test at multiple speeds.

- CHANGE (menu feedback, unreleased): menu confirm/deny SFX. Two new sounds,
   `assets/audio/sounds/sfx_menu_confirm.mp3` (wired via
   `racerSound.menuConfirm()`) and `sfx_menu_deny.mp3` (`racerSound.menuDeny()`),
   fire on every menu edge across the game: MAIN item select, GAMEMODES
   (TIME ATTACK confirm; SINGLE RACE / HEAD2HEAD are unavailable so they buzz
   deny and drop into the NOTICE card), COURSES (confirm starts the race, back
   returns to PLAY), NOTICE + CONTROLS dismiss, OPTIONS (fullscreen toggle,
   key-bindings, BACK) and its PAUSE twin (RESUME, fullscreen, bindings, QUIT),
   BINDINGS (successful key capture blips confirm; pressing ESC during capture
   cancels with deny; back returns to the calling menu), and ABOUT (confirm/
   back dismiss). Slider adjusts and row navigation stay silent — only
   confirm/cancel decisions beep.

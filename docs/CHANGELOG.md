# CHANGELOG — Froyo / Crawlspace Engine

APPEND-ONLY. Never rewrite or delete old entries; add new entries at the BOTTOM.
Each entry: date-less session tag, what changed, why, and files touched.
Purpose: full history of changes & fixes so regressions can be traced.

---

## [Session: Asset Import & Wiring]
- Wired all user asset CDN URLs (textures, GLBs, audio) into `textureatlas.js`, `islandatlas.js`, `game.js`, `audio.js`, `main.js`.

## [Session: Texture Pipeline Fix] (Phase 0 base)
- FIX: `engine/textureloader.js` — added `img.crossOrigin = "anonymous"` before `img.src` (tainted-canvas SecurityError made every texture silently null).
- FIX: `game/game.js` `_loadBiomeTerrainTextures()` — removed `new URL(url, import.meta.url)` wrapper (garbled absolute CDN URLs in sandboxed modules). DO NOT re-add.
- FIX: `game/textureatlas.js` — added missing `jungle`, `golden`, `volcanic` entries to `BIOME_TEXTURES`.

## [Session: Collision Fixes] (Phase 0 base)
- FIX: `engine/geometry.js` `loadGLBMeshIfAvailable` — HEAD preflight returned 405 and silently skipped models; removed/bypassed preflight.
- FIX: `game/physics.js` — narrow-phase landing checks failed on flipped face normals for new island geometry; landing check adjusted.

## [Phase 1 — Platforming Feel]
- 1.1: coyote frames (7) + jump buffer (7) + variable jump cut in `game/physics.js`.
- 1.2: camera collision avoidance in `engine/camera.js` (`updateCamera` takes `platforms`).
- 1.3: one-way platforms (`p.oneWay`/`b.oneWay`, bridge planks), steep-slope slide in `physics.js`/`world.js`.

## [Phase 2.1 — World Editing Tools]
- Level Format v1 spec + `validateLevel()` (`tools/levelformat.js`), wired into main.js Load Map and hot-reload.
- Debug flycam (`game/flycam.js`, F key in gameplay; world freezes).
- Hot-reload (`tools/hotreload.js`, `?hotreload[=path]` polls level JSON).
- Phase 2.3 audit: affine texturing, vertex snap, Bayer dither, distance fog already in `engine/renderer.js` — do not re-add.

## [Session: Blender Removal]
- REMOVED: `tools/blender_export.py` reduced to deprecation stub — Blender authoring dropped by user decision; scene editor is the authoring tool. Blockbench→GLB works through the existing GLB pipeline with zero new code. DO NOT rebuild the Blender exporter.

## [Session: Phase 0–2 Sanity Check + Changelog]
- Created this append-only CHANGELOG.md; policy noted in ARCHITECTURE.md.
- VERIFIED intact: all three Phase 0 texture fixes; Phase 1.1 coyote/buffer; 1.2 camera collision called with `world.platforms` (game.js:1704); 1.3 oneWay + slope slide; 2.1 flycam F-toggle wiring, hot-reload param wiring, validateLevel on map import; blender stub in place. Flycam movement math matches engine yaw convention (yaw 0 = +Z) — W should fly forward.
- VERIFIED: all cross-file imports/exports resolve (main.js, game/*, engine/*, tools/*). No missing exports.
- KNOWN ISSUES (flagged, not yet fixed):
  1. `game/skypalettes.js` is an orphan duplicate of `game/skypalette.js` (only the latter is imported). Delete or ignore — drift hazard.
  2. `*_UPDATED.md` doc duplicates (README/ARCHITECTURE/DESIGN/AGENTS/CHECKPOINT_UPDATED.md) clutter root; canonical docs are the non-suffixed ones.
  3. `main.js` rAF wrapper references `tickCRT` while its import is commented out — harmless now (`crt` is always null) but will throw if CRT is re-enabled without restoring the import.
  4. `README.md` is stale (references `models/` dir layout and has duplicated trailing headings).

## [Session: Cleanup Pass + Phase 2.2]
- CLEANUP (all 4 flagged items from previous session resolved):
  1. `game/skypalettes.js` → deprecation stub (orphan duplicate of `skypalette.js`; nothing imported it).
  2. All 5 `*_UPDATED.md` files → one-line "superseded" stubs pointing at canonical docs.
  3. `main.js` — removed the rAF wrapper that referenced `tickCRT` with its import commented out (would throw if CRT re-enabled); left a NOTE comment on how to restore CRT.
  4. `README.md` rewritten — removed stale `models/` dir references and duplicated trailing headings; documents actual layout, docs, and debug tools.
- PHASE 2.2a — Texture atlas packing:
  - `engine/textureloader.js`: new `packTextureAtlas(urls, opts)` — loads all unique images, shelf-packs into ONE canvas, single `getImageData`; returns Map<url, view> where each view shares the atlas buffer with `{ox, oy, stride}` sub-rect fields. Views seeded into the `loadTexture` cache.
  - `sampleTextureNearest` now honors `ox/oy/stride` (defaults 0/0/width — standalone textures unaffected; wrap-tiling wraps in local space then offsets, so tiling stays correct).
  - `game/game.js` `_loadBiomeTerrainTextures()` packs all biome zone URLs into one atlas; per-URL `loadTexture` remains as fallback if packing fails.
- PHASE 2.2b — UI spritesheet slicing:
  - NEW `engine/spritesheet.js`: `loadSpriteSheet(url, {cols?, rows?})` — auto-detects sprite grid via transparent gutters (or explicit uniform grid); returns row-major sprite list, empty cells dropped. `drawSpriteFit(rd, sprite, x, y, targetH)` — nearest blit into buf32, alpha<128 skipped, HUD-space.
  - `game/game.js`: `_loadUISprites()` slices `TEX.ui.icons` at boot into `this.uiSprites` (null on failure → HUD text fallback).
  - `game/hud.js`: `drawHUD(rd, hud, debug, icons)` — sprinkle/lives panels draw icon sprites (indices `ICON_SPRINKLE=0`, `ICON_LIFE=1`, adjustable constants at top) with the old "SPR"/"LVS" text as fallback.
- Phase 2 is now COMPLETE (2.1 tools, 2.2 pipeline, 2.3 already existed).
- VERIFY in-browser next session: HUD icon indices correct; terrain looks unchanged with atlas (`[atlas] packed N textures into WxH` in console); flycam W-direction (carried over).

## [Session: GLB Visual/Collision Alignment Fix]
- DIAGNOSIS: render + collision transforms for GLB models are IDENTICAL (verified islandatlas.js faces vs buildMeshTris/precacheIslandColors, and mapgen-export inlineMesh path). The perceived misalignment came from landing RESOLUTION in `game/physics.js`:
  1. The bbox-top AABB "safety net" (added in the earlier Collision Fixes session) landed the player on an invisible flat floor at the model's PEAK height across the whole island XZ footprint — player floated mid-air above sloped surfaces, self-sustaining each frame.
  2. Landing snapped to whichever qualifying face iterated LAST in the face buffer (order-dependent), and flipped-normal acceptance let interior/underside faces win.
- FIX (`game/physics.js` GLB narrow-phase): now tracks the HIGHEST face under the player's XZ column inside the snap window (normal-sign agnostic, so flipped-normal exports still land) and resolves once after the loop; slope classification uses that face's true upward normal. The bbox-top safety net is REMOVED (do not re-add — it was the misalignment). faceCount===0 AABB fallback kept. Wall push-out unchanged.

## [Session: Void Floors + Solid Mountains/Buildings] (entry deferred from prior session)
- FIX (`game/world.js` magnetization pass): collision AABB recompute used `* 3.5` where `* 0.5` (midpoint/half-extent) was required → 7×-oversized invisible collision boxes centered at 7× island position ("standable floors in the void", block islands with no collision where visible). Also corrupted islandCentres → phantom bridge/wind placement. Fixed to `0.5` (comment guards regression).
- FIX (`game/game.js`): mountains + buildings baked into collision faces via `_bakeDecoCollision` using the EXACT render transform (yaw+scale baked); registered as collision-only platforms. Buildings re-seat on fresh islands every world regeneration (were stale after reset).

## [Session: Spawn Spacing, Verticality & Aware Spawning]
- DIAGNOSIS (`game/world.js`): (1) ring radii hardcoded 24–44 / 48–72 sat INSIDE the 2×-scaled portal island footprint (half-extent ≈ 44); (2) `buildVoronoiSectors` looped `for (i = 2; ...)` so INNER_COUNT 1–2 produced ZERO inner sectors while OUTER_COUNT 20–21 crammed ~19 islands into one thin band; (3) failed rejection sampling fell back to placing at sector centre REGARDLESS of overlap → the stacks inside the portal island.
- FIX: ring radii now derive from real portal footprint (`portalClearR + CHILD_HALF + gap`): inner ≈ 72–92, outer ≈ 106–138 (inside FOG_FAR 200). Counts rebalanced: 5–6 inner + 6–8 outer (was ~19). Sector loop starts at 0; minR only jitters UP.
- Aware spawning: shape built BEFORE sampling so overlap test uses real halfW/halfD; on failure sampler walks OUTWARD past maxR; if still blocked returns null and the island is SKIPPED (no more model stacks). MIN_SEP 10→12. Removed sector.minR mutation.
- Verticality: child base heights = portalTop + PLATFORM_HEIGHT_LUT (inner +6.4..+16, outer +12.8..+28.8 above portal top) — world climbs upward and outward from spawn.
- BRIDGE_MAX_GAP 10S→14S to match wider neighbour distances.
- (`game/game.js`) horizon décor pushed past the new island band: mountains 110–160→180–240, land rings 130–190→200–270.

## [Session: Halved Ring Distance + 2/3 Island Size] (user-requested tuning)
- (`game/islandatlas.js`) child TARGET_HALF_W/D 22 → 22*(2/3) ≈ 14.7 — GLB child islands (render + prescaled collision faces) at 2/3 size. Portal island unchanged (22 × 2).
- (`game/world.js`) `CHILD_SHAPE_SCALE = 2/3` + `scaleShapeInPlace` applied to procedural shapes only (GLB shapes already scaled by atlas — do not double-scale).
- Ring radii halved: inner 72–92 → `portalClearR*0.92..1.14` (≈40–50), outer 106–138 → `portalClearR*1.20..1.57` (≈53–69).
- placedIslands portal entry reduced to a 0.1× "core" — full 44-unit bounding box would per-axis-AABB-reject the entire halved inner ring; portal clearance is enforced by ring minR (jitters only UP).
- MIN_SEP 12→8 and BRIDGE_MAX_GAP 14S→7S, both scaled proportionally with the tighter layout.

## [Session: Ring Widen ~25% + mountain_B Model Swap] (user feedback: "a bit too tight radially")
- (`game/world.js`) ring multipliers widened ~25% (≈3/4 of the pre-halving distances): inner 0.92..1.14 → 1.15..1.42 (≈51–62), outer 1.20..1.57 → 1.55..1.96 (≈68–86). Island size (2/3) unchanged.
- BRIDGE_MAX_GAP 7S→9S to keep bridge coverage at the wider neighbour distances.
- Horizon décor untouched — mountains 180–240 / land rings 200–270 still clear the widened outer band (worst-case outward-walk ≈110).
- (`game/game.js`) mountain_b asset URL swapped to the new user-uploaded mountain_B_model.glb (2195d32f-…). Placement/biome logic (butte = sand) unchanged.

## [Session: mountain_B Re-swap + Lower Child Island Rings]
- (`game/game.js`) mountain_b asset URL swapped again → 714760cb-… (prior upload had no textures, rendered invisible). Placement/biome logic unchanged.
- (`game/world.js`) child island ring heights lowered one LUT band so the inner ring is always double-jump reachable from the portal rim: inner +6.4..+16.0 → **+3.2..+9.6**, outer +12.8..+28.8 → **+9.6..+22.4** (ring-to-ring climb step preserved). Radial distances untouched.

## [Session: Bridge Flatsprite System] (entry deferred from prior session)
- (`engine/renderer.js`) flatsprite system: `clipNearUV()` (near-clip lerping u/v), `buildTexturedFace()` (UV-aware buildFace), `buildFlatSprite()` (oriented horizontal textured quad, double-sided, underside shaded 0.55). Alpha cutout in `drawTexturedTriangle`: texels with alpha < 128 skip depth AND color writes.
- (`game/game.js`) bridges render as textured planes instead of GLB: `_loadBridgeMesh()` → `_loadBridgeTexture()` (rope-bridge sprite a829b7ae-…, 64×64, transparent slat gaps). `MODEL_URLS.bridge` kept but UNUSED; `_bridgeMesh/_bridgeRawLen/_bridgeScale` removed. Fallback: `buildOrientedPlank` until texture loads. Collision/one-way physics untouched.

## [Session: Connected Bridge Faces] (user request: "bridge builder needs to connect the bridge faces")
- (`game/world.js` `buildBridge`) two-pass builder: pass 1 computes plank centers + arc top heights; pass 2 gives each plank block shared edge points `_e0x/_e0y/_e0z` (rear) and `_e1x/_e1y/_e1z` (forward) — interior edges are the exact midpoint (position + averaged top height) between neighboring planks; end planks overhang by plankL onto the islands. Collision AABBs unchanged (visuals-only).
- (`engine/renderer.js`) new `buildFlatSpriteSpan(x0,y0,z0, x1,y1,z1, halfW, color, texture, cam)` — textured quad between two edge points, tilting with the height difference; consecutive spans sharing edges form a continuous ribbon. Same u/v convention + underside shading as `buildFlatSprite`.
- (`game/game.js`) bridge render branch prefers the connected span when `_e0x` present; legacy flat-per-plank `buildFlatSprite` and solid `buildOrientedPlank` kept as fallbacks.

## [Session: Spline-Based Bridges] (user request: "I think we should do spline based bridges")
- (`game/world.js` `buildBridge`) path is now a cubic Bézier spline: P0/P3 at the actual island top heights (bridges between islands at different heights now SLOPE between them instead of floating at the average height), control points dropped by `sag=0.8*S` (mid dip ≈0.6*S, matches old arc) and offset sideways by a random `bow` (≤ min(dist*0.25, 2.5*S)) for a gentle lateral curve. Plank centers sampled at t=i/count; edges sampled EXACTLY on the spline at t=(i±0.5)/count (identical sample shared by neighbors — replaces the midpoint-averaging approximation). Blocks additionally carry `_p0x/_p0z/_p1x/_p1z` (spline XZ perpendicular at each edge). Collision AABBs still flat-topped per plank, top at the spline deck height; one-way physics unchanged.
- (`engine/renderer.js` `buildFlatSpriteSpan`) 4 optional trailing params `p0x,p0z,p1x,p1z` — per-end perpendiculars so side rails stay seamless through the lateral bow; omitted → derived from span direction (old behavior, other callers unaffected).
- (`game/game.js`) bridge render branch passes `b._p0x, b._p0z, b._p1x, b._p1z` to `buildFlatSpriteSpan`. Fallback branches untouched.

## [Session: Continuous Bridge Texture Tiling] (user report: "texture doesn't tile across the entire spline surface")
- (`game/world.js` `buildBridge`) cumulative arc length along the spline (polyline approx, ≥16 subsamples) → each block carries continuous texture coords `_v0/_v1` (arc length / spacing, in repeat units; overhang edges extend ±plankL/spacing). Shared with neighbors like the edge points, so v never resets per span.
- (`engine/renderer.js` `buildFlatSpriteSpan`) 2 optional trailing params `v0,v1` — per-end texture v in repeat units; omitted → 1/0 (one sprite per span, old behavior). u inset to 0.9999 so wrap-mode u=1.0 can't sample column 0. Same inset added to `buildFlatSprite` (legacy fallback).
- (`game/game.js`) bridge texture now loaded with `wrap: true` (was clamp — repeats couldn't tile at all); render branch passes `b._v0, b._v1`.

## [Session: Bridge Spline Collision on Map Load] (entry deferred from prior session)
- (`game/game.js`) NEW `_registerBridgeCollision()` — on map load, each bridge plank's RENDERED ribbon quad (edge points ± spline perpendicular × `_plankW`, same corners `buildFlatSpriteSpan` draws) is baked into 2 triangles and pushed as a collision-only platform `type:"bridge_col"` (`collisionOnly:true`, `oneWay:true`, `glbModel:{faces,faceCount:2,topY}`), mirroring the ambient-deco pattern. Marks the visual plank `p._faceCollision=true`; clears stale `bridge_col` entries first. Called from all 3 world-set paths (atlas-ready gen, `_resetGame`, `loadWorldFromSceneData`). Legacy planks without `_e0x` keep their AABB.
- (`game/physics.js`) GLB face landing gained a one-way gate; wall push skipped for `p.oneWay`; legacy flat-AABB branch skips planks with `p._faceCollision` (invisible flat top no longer fights the tilted ribbon).

## [Session: Bridge Fall-Through Fix] (user report: "I keep falling through the bridges")
- ROOT CAUSE: the one-way face gate `feetNow - player.vy < faceY - 0.05` rejected faces whenever last frame's feet were >0.05 below the face at the player's NEW XZ — but walking UPHILL on a sloped spline raises the deck by slope×speed per frame (> 0.05), so every ascending plank was skipped, the player never re-grounded, and gravity pulled them through the deck. Downhill/flat spans worked, masking it.
- FIX (`game/physics.js` one line): gate now applies only while airborne — `p.oneWay === true && !wasGrounded && ...`. Grounded walking follows the slope via the normal snap window (±0.15/−0.8); jump-up-through-from-below unchanged (jump sets `grounded=false` before `wasGrounded` is captured, and landing already requires `vy <= 0`). Max fall 0.55 < 0.95 snap window, so no tunneling path exists.

## [Session: Bridge Sprite Crop-to-Content] (user report: "still visual gaps in the bridges — sprite needs to be cropped to content before tiling")
- ROOT CAUSE: the bridge plank PNG has transparent padding around the artwork; with wrap-mode arc-length tiling, that padding repeats between every tile → periodic see-through gaps along the ribbon.
- (`engine/textureloader.js`) NEW `cropToContent` option on `loadTexture()` — scans the alpha channel for the opaque bounding box (`alphaBounds`, threshold 8, overridable via `alphaThreshold`) and re-extracts just that sub-rect, so tiles repeat artwork edge-to-edge. Cache key extended with `|crop` so cropped/uncropped variants of the same URL don't collide (atlas-seeded entries unaffected).
- (`game/game.js`) `_loadBridgeTexture()` now passes `{ wrap: true, cropToContent: true }`.

## [Session: Fewer Bridges + Stepping-Stone Platforms] (user request: "reduce their spawn amount, bridges occasionally between islands, otherwise spawn platforms")
- (`game/world.js`) bridge pass now rolls `BRIDGE_CHANCE = 0.35` per eligible island pair: hit → `buildBridge` (unchanged); miss → NEW `buildSteppingStones` — a line of floating one-way hop platforms between the SAME edge anchors (supportA/supportB) the bridge would have used. Stones: spacing ≈2.1*S (inside double-jump reach), perpendicular jitter ±0.6*S, Y lerps between deck heights with a sin() mid-gap dip (0.5*S) + small noise, half-extents 0.8–1.2*S × 0.2–0.3*S, `type:"hop"`, standard block AABB collision + generic cube render path (no new renderer/physics code).

## [Session: Phase 3.1 — Enemy AI Rewrite + Combat Bug Fixes]
- (`game/enemyai.js`) full rewrite: waypoint patrol on home island (no more random drift), line-of-sight aggro (close + same height band), contact damage with knockback, island-clamped chase, freeze→shatter mechanic (2nd breath hit OR touching a frozen enemy shatters for 1 HP; natural thaw is free), post-shatter i-frames. Boss state machine: telegraphed attacks (visible freeze-in-place tell), radial 8-shot ring below half HP, attack speed escalates across 3 damage phases.
- FIX: boss instant-kill by two breath puffs — shatter damage is HP-based now (was bypassing damage phases).
- FIX: frozen-timer double-decrement — `enemyai.js` is now the SINGLE owner of enemy timers (frozenT, bobPhase, spawnT, _shatterFxT); the duplicate tick in breath/game paths removed. Do not re-add timer decrements elsewhere.

## [Session: Phase 3.2 — Hazards + Boss Defeat + SFX Rework]
- NEW `game/hazards.js`: `spawnHazards()` (every ~3rd island, cycles spike→lava→crusher, skips boss arena), `stepHazards()` (spike contact hurt kb 0.15; lava = instant death via `STATE.DEAD`, respawn flow handles it; crusher FSM wait→telegraph(20f shake)→slam→rest→rise, overlap hurt kb 0.35), `buildHazardTris()` (grey tri-prism spikes, pulsing lava pad, crusher block + dark-red danger pad).
- (`game/world.js`) imports/calls `spawnHazards`; `hazards` in world return; `spawnT: 40` on both enemy spawn sites (regular + boss) for spawn-in delay.
- (`game/game.js`) `stepHazards` in tick + `buildHazardTris` in render; boss defeat sequence — "BOSS DOWN!" flash, death sting, big 2.5× crystal worth 50 sprinkles (`{reward:50, big:true}`; crystal reward now `c.reward ?? 10`).
- SFX rework: freeze/death sounds are flag-based (`e._frozenSfx` / `e._deathNotified`) after `stepEnemyAI` — the old prev-state snapshot ran too early and missed breath-caused freezes/shatters entirely.

## [Session: Phase 3.3 — Live Tunable Hooks + Spawn/Shatter FX]
- (`game/game.js`) live tunables wired into the render loop (imports were staged last session): enemy bob `+ TUN_ENEMIES.heightOffset`, mesh scales `× TUN_ENEMIES.size` (boss + regular + billboard fallbacks), yaw `+ TUN_ENEMIES.rotation`; portal `× TUN_PORTAL.size` with `hexToABGR(TUN_PORTAL.color)` / `darkenABGR(pc, 0.5)` (locked portal keeps grey); player mesh `× TUN_PLAYER.size`, yaw `+ TUN_PLAYER.rotation`, billboard fallback scaled too.
- (`game/game.js`) enemy spawn-in FX (converging ice-cube burst while `e.spawnT > 0`, cubes shrink inward and descend) + shatter FX (expanding ice-shard burst while `e._shatterFxT > 0`), both via `pushBox`, colors rgba(160,220,255)/rgba(80,140,200) matching the regular death burst.
- Phase 3 (Enemies & Hazards) COMPLETE. Needs playtest.

## [Session: Phase 4 — Collectibles, HP/Continues, World Progression]
- NEW `game/collectibles.js`: sprinkle gem + 1-UP cherry spawn/step — walk-over collection, per-world `SPK n/m` completion counter, "ALL SPRINKLES!" +50 bonus on clearing a world, every 100 sprinkles = extra life (single reward pipe for all sprinkle sources).
- Gem RENDER pass in `game/game.js`: gems bob/spin over islands, cherries rotate at island centers, pickup pops an expanding sparkle burst. Rotating Sprinkle GLB loader wired.
- Gradient sprinkles: NEW `"sprinkleGradient"` colorMode in `engine/geometry.js` — hot-magenta → cyan vertical gradient, partly self-lit so gems read against any biome terrain.
- Health system: 3 hearts (HUD pips under sprinkle counter); a hit costs one heart + 90 i-frames; player FLICKERS while invulnerable; enemies, projectiles, and hazards all respect i-frames; losing all hearts costs a life.
- Continues: 2 per run — game over offers A: CONTINUE (same world, 5 fresh lives) or START (new game). Saved-state plumbing included.
- World progression (4.3): portal clear → `_advanceWorld()` warps to WORLD 2, 3, 4… with cycling sky biome (ice → grass → sand → bubblegum → volcanic); sprinkles/lives/continues carry over.

## [Session: Phase 4.4 — Per-Level Biomes via Top-Level JSON Token]
- Level JSON now carries top-level `"biome"` (terrain + sky) and optional `"skyBiome"` (sky-only override) tokens.
- (`game/game.js`) `_resolveLevelSkyBiome()` precedence chain (top-level skyBiome → mapgen.levelSkyBiome/skyBiome → meta.skyBiome → top-level biome/levelBiome → mapgen.levelBiome/biome → world.meta.skyBiome) + `_applySkyBiome()` helper; `loadWorldFromSceneData` retints BOTH terrain and sky per level; `_resetGame` resets sky to the level's own biome (fixes stale sky after world-cycling → game over → new game). Unknown biome names degrade to the default palette.
- (`tools/mapgen-export.js`) `getSceneSkyBiome()`; `worldToSceneData` emits top-level `biome`/`skyBiome`; `sceneDataToWorld` carries `world.skyBiome` + `world.meta.skyBiome` so the token round-trips.
- (`tools/levelformat.js`) header spec documents both tokens; `validateLevel` biome chain extended with `data.biome`; NEW `VALID_SKY_BIOMES` (ice/grass/sand/bubblegum/volcanic/default — sky palette set lacks jungle/golden) with warning-only `skyBiome` check.
- (`tools/scene-editor.html`) `getSceneData()` emits top-level `biome`/`skyBiome`; `loadScene` + autosave restore prefer `data.biome`/`data.skyBiome` over the legacy mapgen/meta locations.

## [Session: Froyo Hand-Painted Textures + Model-Swap Animations]
- (`engine/geometry.js`) `loadGLBMesh` now extracts the GLB's embedded texture (`_extractGLBTexture` → CPU sampler) and returns it as `meshData.texture`.
- (`engine/geometry.js`) NEW `loadGLBAnimation(url, name, {fps=12, maxFrames=24})` — bakes a GLB's first animation clip into flipbook frames (skinned via `boneTransform` or rigid via node transforms; matrixWorld IS applied here, unlike loadGLBMesh); normals rebuilt per frame (`_computeVertexNormals`); shared indices/uvs/colors/texture across frames. Returns `{frames, frameCount, duration, texture, animated}`.
- (`engine/geometry.js` `buildMeshTris`) NEW `"textured"` colorMode — samples the mesh's own UVs + embedded texture, lit tint via baseColor (pass white for pure texture). Also auto-enables in DEFAULT mode for any mesh with texture+uvs (non-terrain models get textures back); terrain modes ("island"/"skyRing") untouched.
- (`game/game.js`) `MODEL_URLS.froyo_body` swapped to new hand-painted upload (db46142e-…); added `froyo_walk/jump/fall/land`. `_loadFroyoMesh` rewritten: loads all 5 via `loadGLBAnimation` (per-anim try/catch; idle required), keeps the EXACT legacy normalization math from idle frame 0, stamps the idle bbox pivot on every frame of every anim (feet stay aligned across swaps).
- (`game/game.js`) NEW `_pickFroyoFrame(player)` anim state machine: idle ↔ walk grounded; jump one-shot → fall loop airborne; land one-shot on touchdown (early-out if moving); clock only advances during GAMEPLAY; missing anims fall back to idle. Player render passes the picked frame with colorMode `textured` (white base; HIT = red tint) or legacy `froyo` if untextured.

## [Session: Per-Mesh GLB Textures] (user report: "bowl texture loads but the rest of the meshes aren't loading their textures")
- (`engine/geometry.js`) ROOT CAUSE: `_extractGLBTexture` returned only the FIRST texture found across all meshes, so every merged mesh sampled the bowl texture (all-brown Froyo). Replaced with `_extractGLBTexturesPerMesh` (one CPU sampler per mesh, deduped by source image) + `_buildTriTextures` (per-triangle texture lookup aligned to the merged index buffer). `loadGLBMesh` and `loadGLBAnimation` now return `triTextures` alongside `texture` (first-found, kept for truthiness checks); every baked animation frame carries `triTextures`.
- (`engine/geometry.js` `buildMeshTris`) textured branch now picks `triTextures[t]` per triangle; untextured segments in an otherwise-textured model fall back to vertex colors / base color instead of sampling the wrong map.
- (`game/game.js`) Froyo load log now prints `meshTextures: N` (distinct textures found) for playtest verification.
- (`game/tunables.js`) Synced tune-mode slider values: player.size 1.0→3, player.rotation 0→90 (creator fixed the facing-left issue via yaw offset slider).

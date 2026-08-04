/**
 * game.js — Froyo Engine main orchestrator (Spec Sections V, XII)
 *
 *   Drives the state resolution pipeline + state machine:
 *
 *     MENU → GAMEPLAY → PAUSE / INTERMISSION / GAME_OVER
 *
 *   Per-frame in GAMEPLAY:
 *     1. Sample input
 *     2. Bitwise update (state.js)
 *     3. Discrete resolution (state.js)
 *     4. LUT execution: physics → camera → breath → enemies
 *     5. Render: sky → world geo (depth sorted) → particles → HUD
 */
import { InputController, BTN_FLAGS } from "../engine/input.js";
import { resolveBitwise, resolveDiscrete, STATE } from "../engine/state.js";
import { generateWorld, stepMovingPlatforms } from "./world.js";
import { generateHubWorld, HUB_WORLDS } from "./hubworld.js";
import { createCamera, updateCamera, castLookRay } from "../engine/camera.js";
import { getSkyPalette } from "./skypalette.js";

import {
    setSkyPalette
} from "../engine/renderer.js";
import { stepPhysics } from "./physics.js";
import { createBreathSystem, fireBreath, stepBreath, stepBreakables } from "./breath.js";
import { createTransition, tryPortal, stepTransition, transitionWarpAmount } from "./portal.js";
import { loadSave, writeSave, downloadFroyoFile } from "../data/persistence.js";
import { sceneDataToWorld } from "../tools/mapgen-export.js";
import {
  createRenderer, clearSky, present,
  buildCube, buildTrapezoid, buildTriPrism, buildOrientedPlank,
  buildFace, buildBillboard, buildFlatSprite, buildFlatSpriteSpan, drawPixelW,
  buildVoidPlane, buildIslandTaper,
  buildTree, buildPine, buildSpire, buildMushroom, buildCactus, buildGemstone, buildLantern,
  drawTriangle as drawTri,
  drawTexturedTriangle as drawTexturedTri,
  project as projectVertex,
  rgba,
  drawRect, drawText,
} from "../engine/renderer.js";
import { createHUD, drawHUD, drawCenterPanel, tickHUD, notifySprinkles, notifyLives, flashMessage } from "./hud.js";
import { MOVE, SCREEN_W, SCREEN_H } from "../engine/luts.js";
// frustum culling removed — back-face culling only
import {
  threeReady, loadGLBMesh, loadGLBMeshIfAvailable, loadGLBAnimation, buildMeshTris,
  syncThreeCamera, precacheIslandColors, buildMeshTrisFromCache,
} from "../engine/geometry.js";
import { stepEnemyAI, projectiles, resetProjectiles } from "./enemyai.js";
import { createFlycam, stepFlycam, applyFlycamToCamera } from "./flycam.js";
import { loadIslandAtlas, getAtlasProgress, isAtlasReady, findIslandModelById } from "./islandatlas.js";
import {
  sfxJump, sfxDoubleJump, sfxIceBreath, sfxCrystalBreak, sfxCrateBreak,
  sfxEnemyFrozen, sfxEnemyDie, sfxPlayerHit, sfxEnemyShoot, sfxWind,
  sfxPortalOpen, sfxCollect, sfxLand,
  bgmStart, bgmStop, bgmSetVolume, bgmGetVolume,
  sfxSetVolume, sfxGetVolume,
} from "../engine/audio.js";
import { loadTexture, packTextureAtlas } from "../engine/textureloader.js";
import { getBiomeTextures, TEX } from "./textureatlas.js";
import { loadSpriteSheet } from "../engine/spritesheet.js";
import { TUN_ENEMIES, TUN_PLAYER, TUN_PORTAL, hexToABGR, darkenABGR } from "./tunables.js";
import { stepHazards, buildHazardTris } from "./hazards.js";
import { stepGems } from "./collectibles.js";
// Asset URLs injected from user-provided uploads
const _ASSET_BASE = "/api/games/7002d48f-7c22-4217-94f6-b2237620a40a/assets/";
const MODEL_URLS = {
  froyo_body:   _ASSET_BASE + "db46142e-e50b-4118-829c-1097b04a81b6", // froyo_body_model.glb (hand-painted, idle loop)
  froyo_walk:   _ASSET_BASE + "64673c51-9a58-4e61-88d1-97166516d3e3", // froyo_walking.glb (loop while grounded+moving)
  froyo_jump:   _ASSET_BASE + "a55a3b9a-9ff0-414b-8068-cc5bb5c18463", // froyo_jump.glb (play once on jump)
  froyo_fall:   _ASSET_BASE + "25e94fcc-9978-4d93-a52b-aad13b620c66", // froyo_fall_loop.glb (loop until landing)
  froyo_land:   _ASSET_BASE + "2b75bdfc-cf42-424b-b580-a065db5e9a2a", // froyo_land.glb (play once on landing)
  cherry:       _ASSET_BASE + "349426d7-9b38-4c5d-b44a-a503c133d85d", // cherry.glb
  sun_enemy:    _ASSET_BASE + "4b4ef684-cab8-42e5-a713-be25e987a463", // sun_enemy_model.glb
  skydome:      _ASSET_BASE + "fe8ca0ae-6883-424b-8bc4-c9f7ad5da48f", // skydome_model.glb
  skyring:      _ASSET_BASE + "b0837a9c-13a1-4399-b851-7b2b14c89486", // skyring_model.glb
  bridge:       _ASSET_BASE + "b49185f3-ab32-48e4-96c5-888fef67621c", // bridge_model.glb (UNUSED — bridges now render as flatsprites)
  // Additional models available
  skyring2:     _ASSET_BASE + "64f03f1a-14e1-4395-b33d-e428a2397f64", // SkyRing_model2.glb
  sprinkle:     _ASSET_BASE + "043286c8-0c2f-4c9e-9665-845d47cb680d", // Sprinkle_model.glb
  land_ring_a:  _ASSET_BASE + "c98f7ea7-dd4d-45fe-9e29-19f7d99a9b38", // LandRing_A.glb
  land_ring_b:  _ASSET_BASE + "f23417e5-ea29-4cbd-8906-85dce61d3047", // LandRing_B.glb
  land_ring_c:  _ASSET_BASE + "c1998686-474f-4e13-acd6-444a57628465", // LandRing_C.glb
  mountain_a:   _ASSET_BASE + "9893b300-bb2c-4c56-a6b0-85efde8ebd49", // mountain_A_model.glb
  mountain_b:   _ASSET_BASE + "714760cb-85e6-4965-b036-39a44f2437df", // mountain_B_model.glb (re-textured — previous was untextured/invisible)
  bldg_igloo:   _ASSET_BASE + "5bd39d42-266f-4104-8e9f-f9b7a1abf1ce", // bldg_igloo.glb
  bldg_stone:   _ASSET_BASE + "2c728e8b-73a5-4ba5-b97c-fa86ef676357", // bldg_stone.glb
  bldg_wood:    _ASSET_BASE + "e90b859b-f04b-45e7-8490-b0148d73487c", // bldg_wood.glb
  boot_front:   _ASSET_BASE + "218073fa-f7f3-4a3e-a2c9-8e858f23bd86", // boot_logo_front.glb
  boot_back:    _ASSET_BASE + "cc3a6ccf-19c5-4b42-b445-a1edb9186a1b", // boot_logo_back.glb
};
// Legacy path base kept so any remaining string interpolation doesn't crash
const MODEL_BASE_URL = _ASSET_BASE;

const DEFAULT_ISLAND_BIOME = "grass";
const DEFAULT_SKY_BIOME = "ice";

// Game-owned sky/level palettes. The engine only receives packed colors.
// This is intentionally light: authored maps can later set `levelBiome`/`biome`
// and the sky ring + fallback island colors will inherit from here.
const LEVEL_BIOME_PALETTES = {
  grass:     { top: rgba( 91, 141,  58), side: rgba( 90,  58,  42), biome: "grass" },
  ice:       { top: rgba(245, 250, 255), side: rgba( 74, 117, 200), biome: "ice" },
  sand:      { top: rgba(217, 191, 119), side: rgba( 90,  58,  26), biome: "sand" },
  bubblegum: { top: rgba(255, 153, 255), side: rgba(176,  80, 192), biome: "bubblegum" },
  jungle:    { top: rgba(128, 232, 128), side: rgba( 42, 106,  42), biome: "jungle" },
  golden:    { top: rgba(255, 176,  80), side: rgba(154,  90,  16), biome: "golden" },
  volcanic:  { top: rgba( 70,  60,  55), side: rgba(160,  55,  35), biome: "volcanic" },
};
LEVEL_BIOME_PALETTES.default = LEVEL_BIOME_PALETTES[DEFAULT_ISLAND_BIOME];

// World-biome cycle — procgen now assigns ONE biome to the whole world
// (world.js stamps `biome`/`skyBiome` on the generated world); each portal
// warp advances to the next entry. World 1 = ice (matches the classic
// default sky). Names must exist in world.js PALETTES.
const WORLD_BIOME_CYCLE = ["ice", "grass", "sand", "bubblegum", "jungle", "golden"];
const worldBiomeFor = (n) => WORLD_BIOME_CYCLE[(((n || 1) - 1) % WORLD_BIOME_CYCLE.length + WORLD_BIOME_CYCLE.length) % WORLD_BIOME_CYCLE.length];

const GAMESTATE = {
  LOADING: "LOADING",
  MENU: "MENU",
  SETTINGS: "SETTINGS",
  GAMEPLAY: "GAMEPLAY",
  PAUSE: "PAUSE",
  INTERMISSION: "INTERMISSION",
  GAME_OVER: "GAME_OVER",
};

const FROZEN_TINT = rgba(180, 230, 255);
const PLAYER_TOP  = rgba(245, 110, 90);   // warm head
const PLAYER_BOT  = rgba(250, 200, 110);  // body
const CRYSTAL_C   = rgba(120, 240, 255);

const ADJ_EPS = 0.2;

function overlap1D(minA, maxA, minB, maxB) {
  return minA < maxB - ADJ_EPS && maxA > minB + ADJ_EPS;
}

function covers1D(minA, maxA, minB, maxB) {
  return minB <= minA + ADJ_EPS && maxB >= maxA - ADJ_EPS;
}

function hasAdjacentFace(block, blocks, axis, dir) {
  const minA = [block.wx - block.sx, block.wy - block.sy, block.wz - block.sz];
  const maxA = [block.wx + block.sx, block.wy + block.sy, block.wz + block.sz];

  for (const other of blocks) {
    if (other === block) continue;
    if (other.sx === undefined || other.sy === undefined || other.sz === undefined) continue;
    if (other.shape || other._axisNX !== undefined) continue;

    const minB = [other.wx - other.sx, other.wy - other.sy, other.wz - other.sz];
    const maxB = [other.wx + other.sx, other.wy + other.sy, other.wz + other.sz];
    const faceA = dir > 0 ? maxA[axis] : minA[axis];
    const faceB = dir > 0 ? minB[axis] : maxB[axis];
    if (Math.abs(faceA - faceB) > ADJ_EPS) continue;

    const axes = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
    if (covers1D(minA[axes[0]], maxA[axes[0]], minB[axes[0]], maxB[axes[0]]) &&
        covers1D(minA[axes[1]], maxA[axes[1]], minB[axes[1]], maxB[axes[1]])) {
      return true;
    }
  }
  return false;
}

function shadeFace(c, brightness) {
  const r = Math.min(255, ((c & 0xff) * brightness)) | 0;
  const g = Math.min(255, (((c >>> 8) & 0xff) * brightness)) | 0;
  const b = Math.min(255, (((c >>> 16) & 0xff) * brightness)) | 0;
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

function buildCubeWithAdjacency(block, camera, blocks) {
  const cx = block.wx;
  const cy = block.wy;
  const cz = block.wz;
  const sx = block.sx;
  const sy = block.sy;
  const sz = block.sz;
  const topColor = block.top;
  const sideColor = block.side;

  const corners = [
    { x: cx - sx, y: cy + sy, z: cz - sz }, // 0 top NW
    { x: cx + sx, y: cy + sy, z: cz - sz }, // 1 top NE
    { x: cx + sx, y: cy + sy, z: cz + sz }, // 2 top SE
    { x: cx - sx, y: cy + sy, z: cz + sz }, // 3 top SW
    { x: cx - sx, y: cy - sy, z: cz - sz }, // 4 bot NW
    { x: cx + sx, y: cy - sy, z: cz - sz }, // 5 bot NE
    { x: cx + sx, y: cy - sy, z: cz + sz }, // 6 bot SE
    { x: cx - sx, y: cy - sy, z: cz + sz }, // 7 bot SW
  ];

  const sideN = shadeFace(sideColor, 0.85);
  const sideE = shadeFace(sideColor, 0.70);
  const sideS = shadeFace(sideColor, 0.55);
  const sideW = shadeFace(sideColor, 0.85);

  const camDx = camera.x - cx;
  const camDy = camera.y - cy;
  const camDz = camera.z - cz;

  const quads = [
    { idxs: [0, 1, 2, 3], color: topColor, nx: 0, ny: 1, nz: 0, axis: 1, dir: 1 },
    { idxs: [4, 0, 1, 5], color: sideN,  nx: 0, ny: 0, nz: -1, axis: 2, dir: -1 },
    { idxs: [5, 1, 2, 6], color: sideE,  nx: 1, ny: 0, nz: 0, axis: 0, dir: 1 },
    { idxs: [6, 2, 3, 7], color: sideS,  nx: 0, ny: 0, nz: 1, axis: 2, dir: 1 },
    { idxs: [7, 3, 0, 4], color: sideW,  nx: -1, ny: 0, nz: 0, axis: 0, dir: -1 },
  ];

  const tris = [];
  for (const face of quads) {
    if (hasAdjacentFace(block, blocks, face.axis, face.dir)) continue;
    const dot = camDx * face.nx + camDy * face.ny + camDz * face.nz;
    if (dot <= 0) continue;
    const pts = face.idxs.map(i => corners[i]);
    for (const tri of buildFace(pts, face.color, camera)) tris.push(tri);
  }
  return tris;
}
const CRYSTAL_S   = rgba(60, 140, 200);
const ENEMY_TOP   = rgba(80, 60, 60);
const ENEMY_BOT   = rgba(120, 80, 80);
const PORTAL_C    = rgba(255, 80, 220);
const PORTAL_S    = rgba(110, 30, 150);
const SHADOW_C    = rgba(20, 16, 30);
const PARTICLE_C  = rgba(200, 240, 255);

export class FroyoGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = createRenderer(canvas);
    this.input = new InputController();
    this.camera = createCamera();
    this.breath = createBreathSystem();
    this.transition = createTransition();
    this.save = loadSave();
    this.hud = createHUD();
    this.hud.sprinkles = this.save.sprinkles;
    this.hud.lives = this.save.lives;

    // Phase 4.3 — the game starts in the HUB (level-select island). Playable
    // worlds are entered by walking into a hub portal.
    this._inHub = true;
    this._pendingWorldNum = null;  // set when a hub portal is entered
    this._lockedFlashT = 0;        // cooldown for locked-portal messages
    this.world = this._makeHubWorld();
    this._levelBiome = this._resolveLevelBiome(this.world);
    this._applySkyBiome(this._resolveLevelSkyBiome(this.world) || DEFAULT_SKY_BIOME);
    this._applyLevelBiomeDefaults(this.world);
    this.player = this._newPlayer(this.world.spawn);

    // Apply persisted audio settings immediately
    sfxSetVolume(this.save.fxVolume  ?? 0.8);
    bgmSetVolume(this.save.bgmVolume ?? 0.55);

    this.gameState = GAMESTATE.LOADING;
    this.frame = 0;
    this.continuesLeft = 2; // Phase 4.2 — limited continues on game over
    this.menuChoice = 0; // 0 = Start, 1 = Settings, 2 = Load Map, 3 = Save, 4 = Reset
    this.debugOpen = false;
    this.onRequestLoadMap = null;
    this._running = false;
    this._lastDebugLines = [];

    // Island geometry precache: Map from platform → { buf, triCount }
    // Built once after atlas loads for all non-moving GLB islands.
    this._islandCache = new Map();
    this._geomCacheReady = false;
    this._geomCacheProgress = 0; // 0..1

    // Snapshot stored on transition out / pause for INTERMISSION restore
    this._snapshot = null;
    this._windNotified = false;

    // Kick off Three.js loading for GLB meshes.
    // World geometry uses pure-JS builders in renderer.js — no Three.js needed.

    // Ambient world decoration models — land rings, mountains, buildings.
    // These are spawned as procedural decoration objects around the world.
    this._landRingMeshes  = [];   // loaded from LandRing_A/B/C.glb
    this._mountainMeshes  = [];   // loaded from mountain_A/B.glb
    this._bldgMeshes      = [];   // loaded from bldg_igloo/stone/wood.glb
    this._ambientDecoReady = false;
    this._ambientDecoPlacements = []; // { mesh, scale, x, y, z, yaw }
    this._loadAmbientDecoModels();

    // Three.js GLB mesh data for the player character.
    // Null until the async GLB load resolves; falls back to billboard until ready.
    this._froyoMesh = null;
    this._loadFroyoMesh();

    // Red cherry — rendered at the player's front muzzle (replaces red cube pip)
    this._cherryMesh      = null;
    this._cherryScale     = 1;
    this._cherryLocalCY   = 0;
    this._loadCherryMesh();

    // Sprinkle gem — rotating collectible (Phase 4.1)
    this._sprinkleMesh    = null;
    this._sprinkleScale   = 1;
    this._loadSprinkleMesh();

    // Sun with sunglasses — rendered as the enemy model
    this._sunMesh         = null;
    this._sunScale        = 1;
    this._sunLocalCY      = 0;
    this._loadSunMesh();

    // SkyDome + SkyboxRing — encompass the perimeter of the level,
    // parallax rotate with camera (yaw-locked to camera).
    this._skyDomeMesh   = null;
    this._skyDomeScale  = 1;
    this._skyRingMesh   = null;
    this._skyRingScale  = 1;
    this._loadSkyMeshes();

    // Bridge flatsprite — bridges render as textured planes (rope-bridge
    // sprite with alpha-cutout gaps) instead of the GLB model.
    this._bridgeTexture = null;
    this._loadBridgeTexture();

    // Boot logo GLBs — rendered on the loading screen in place of the
    // rectangle placeholder. Front mesh = froyo face/top, back = bottom/base.
    this._bootFrontMesh = null;
    this._bootBackMesh  = null;
    this._bootLogoScale = 1;
    this._bootLogoCY    = 0;  // local centre Y offset to vertically align
    this._loadBootLogoMeshes();

    // Biome terrain textures. The game resolves URLs; the engine only samples
    // CPU texture objects passed through triangle metadata.
    this._biomeTextures = new Map();
    this._loadBiomeTerrainTextures();

    // UI icon spritesheet (Phase 2.2) — auto-sliced from icons.png.
    // null until loaded; HUD falls back to text labels.
    this.uiSprites = null;
    this._loadUISprites();

    this._manualWorldLoaded = false;

    // Kick off island atlas loading. When done, regenerate world or resolve
    // an imported world, then precache island geometry and transition to menu.
    loadIslandAtlas()
      .then(() => {
        if (this._manualWorldLoaded) {
          console.log("[game] Atlas ready — resolving imported world GLB references.");
          this._resolveWorldGLBReferences(this.world);
        } else {
          this.world = this._inHub
            ? this._makeHubWorld()
            : generateWorld(Date.now(), { biome: worldBiomeFor(this.save.worldNum) });
          this._levelBiome = this._resolveLevelBiome(this.world);
          this._applySkyBiome(this._resolveLevelSkyBiome(this.world) || DEFAULT_SKY_BIOME);
          this._applyLevelBiomeDefaults(this.world);
          this.player = this._newPlayer(this.world.spawn);
          console.log("[game] Atlas ready — world regenerated with GLB island shapes.");
        }
        this._runGeomPrecache();
        this._placeAmbientDecos();
        this._registerBridgeCollision();
      })
      .catch(err => {
        console.warn("[islandatlas] Load error:", err);
        // Still allow transition to menu even if atlas failed
        if (this.gameState === GAMESTATE.LOADING) this.gameState = GAMESTATE.MENU;
      });

    this.tick = this.tick.bind(this);
  }

  _newPlayer(spawn) {
    const sx = spawn ? spawn.x : 0;
    const sy = spawn ? spawn.y : 0.6;
    const sz = spawn ? spawn.z : 0;
    return {
      x: sx, y: sy, z: sz,
      vx: 0, vy: 0, vz: 0,
      yaw: 0,
      yawVel: 0,
      _prevYaw: 0,
      // Squash & stretch: positive = stretched (rising), negative = squashed
      // (just landed). Decays toward 0 each frame.
      squash: 0,
      _wasGrounded: false,
      state: STATE.NONE,
      grounded: false,
      // jumpTokens: 2 = both jumps available, 1 = first spent, 0 = both spent.
      // Restored to 2 on landing. Replaces canDoubleJump + hasDoubleJumped.
      jumpTokens: 2,
      _wantJump: false,
      _wantJumpCut: false,   // set on A release while rising → short hop
      coyoteFrames: 0,       // grace frames after walking off a ledge
      jumpBufferFrames: 0,   // early-press buffer before landing
      _steepSlope: false,    // standing on >45° face this frame
      _slopeNX: 0, _slopeNZ: 0,
      _glideArmed: false,
      hitT: 0,
      animT: 0,
      // Phase 4.2 — health points + damage invincibility frames
      hp: 3,
      maxHp: 3,
      invulnT: 0,
    };
  }

  // Phase 4.3 — build the hub world from current progress (unlocks depend on
  // worldsCleared + banked sprinkles).
  _makeHubWorld() {
    return generateHubWorld({
      worldsCleared: this.save.worldsCleared ?? 0,
      sprinkles: this.hud.sprinkles,
    });
  }

  // Phase 4.2 — central sprinkle reward: every 100 sprinkles grants a life.
  _awardSprinkles(n) {
    const old = this.hud.sprinkles;
    const now = old + n;
    notifySprinkles(this.hud, now);
    this.save.sprinkles = now;
    if (Math.floor(now / 100) > Math.floor(old / 100)) {
      notifyLives(this.hud, this.hud.lives + 1);
      this.save.lives = this.hud.lives;
      flashMessage(this.hud, "EXTRA LIFE!", 90);
    }
    writeSave(this.save);
  }

  _resolveLevelBiome(world = null, sceneData = null) {
    const raw =
      sceneData?.mapgen?.levelBiome ??
      sceneData?.mapgen?.biome ??
      sceneData?.levelBiome ??
      sceneData?.biome ??
      sceneData?.meta?.levelBiome ??
      sceneData?.meta?.biome ??
      world?.levelBiome ??
      world?.biome ??
      null;

    if (!raw) return null;
    const biome = String(raw);
    return LEVEL_BIOME_PALETTES[biome] ? biome : null;
  }

  // Per-level SKY biome (Phase 4.4) — resolved from the level JSON.
  // Precedence: explicit sky tokens (top-level skyBiome, mapgen/meta variants)
  // → the level's top-level `biome` token → world meta → null (caller default).
  _resolveLevelSkyBiome(world = null, sceneData = null) {
    const raw =
      sceneData?.skyBiome ??
      sceneData?.mapgen?.levelSkyBiome ??
      sceneData?.mapgen?.skyBiome ??
      sceneData?.meta?.skyBiome ??
      sceneData?.biome ??
      sceneData?.levelBiome ??
      sceneData?.mapgen?.levelBiome ??
      sceneData?.mapgen?.biome ??
      world?.meta?.skyBiome ??
      world?.skyBiome ??
      null;
    return raw ? String(raw) : null;
  }

  // Apply a sky biome to the renderer (getSkyPalette falls back to "default"
  // for unknown names, so unvalidated authored tokens degrade gracefully).
  _applySkyBiome(biome) {
    this._levelSkyBiome = biome || DEFAULT_SKY_BIOME;
    setSkyPalette(getSkyPalette(this._levelSkyBiome));
  }

  _getLevelBiomePalette(biome = this._levelBiome) {
    return LEVEL_BIOME_PALETTES[biome] || LEVEL_BIOME_PALETTES.default;
  }

  _getSkyBiome() {
    return this._levelBiome || DEFAULT_SKY_BIOME;
  }

  _getPlatformBiome(p) {
    return p?.biome || this._levelBiome || DEFAULT_ISLAND_BIOME;
  }

  _getPlatformPalette(p) {
    const biome = this._getPlatformBiome(p);
    const base = this._getLevelBiomePalette(biome);
    return {
      top:  (typeof p?.color === "number" && Number.isFinite(p.color)) ? p.color : base.top,
      side: (typeof p?.side  === "number" && Number.isFinite(p.side))  ? p.side  : base.side,
      biome,
    };
  }

  _applyLevelBiomeDefaults(world) {
    if (!world) return;
    world.levelBiome = this._levelBiome || DEFAULT_ISLAND_BIOME;
    if (!Array.isArray(world.platforms)) return;
    for (const p of world.platforms) {
      if (!p.biome) p.biome = world.levelBiome;
    }
  }

  _getSkyPalette() {
    // Sky has its own default: ice/snow. Authored levels can override by setting
    // levelBiome/biome, while untagged islands still fall back to grass.
    const skyBiome = this._getSkyBiome();
    const base = this._getLevelBiomePalette(skyBiome);
    const tex = this._getBiomeTextureTable(skyBiome);
    return {
      ...base,
      biome: skyBiome,
      textureTop: tex?.top || null,
      textureSide: tex?.side || tex?.top || null,
      textureUnder: tex?.under || null,
      textureScale: 0.035,
    };
  }

  // Async geometry precache — called after atlas + world are ready.
  // Iterates through all non-moving GLB island platforms and builds a
  // precacheIslandColors buffer for each. Runs over multiple microtask slices
  // to avoid blocking the main thread during the loading screen.
  _resolveWorldGLBReferences(world) {
    if (!world || !Array.isArray(world.platforms)) return;
    for (const p of world.platforms) {
      if (!p.glbModel && p.glbName) {
        const model = findIslandModelById(p.glbName);
        if (model) p.glbModel = model;
      }
    }
  }

  loadWorldFromSceneData(sceneData) {
    const world = sceneDataToWorld(sceneData);
    if (!world) return false;
    this.world = world;
    this._registerBridgeCollision();
    this._levelBiome = this._resolveLevelBiome(this.world, sceneData);
    this._applyLevelBiomeDefaults(this.world);
    // Phase 4.4 — per-level biome: the level JSON's top-level `biome` token
    // (or explicit skyBiome variants) now drives the sky palette per level.
    this._applySkyBiome(this._resolveLevelSkyBiome(this.world, sceneData) || this._levelBiome);
    this.player = this._newPlayer(this.world.spawn);
    this._manualWorldLoaded = true;
    this._islandCache.clear();
    this._geomCacheReady = false;
    this._geomCacheProgress = 0;
    this._resolveWorldGLBReferences(this.world);
    if (isAtlasReady()) {
      this._runGeomPrecache();
    }
    return true;
  }

  async _runGeomPrecache() {
    const platforms = this.world.platforms;
    const glbPlatforms = platforms.filter(p => p.glbModel && !p.moving && !p.collisionOnly);
    const total = glbPlatforms.length;
    this._geomCacheReady = false;
    this._geomCacheProgress = 0;

    for (let i = 0; i < total; i++) {
      const p = glbPlatforms[i];
      // Yield to browser every 3 platforms so the loading screen can animate
      if (i > 0 && i % 3 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
      try {
        let modelScale = (typeof p.glbModel.scale === 'number' && isFinite(p.glbModel.scale)) ? p.glbModel.scale : 1.0;
        if (typeof p.glbModel.scale !== 'number' || !isFinite(p.glbModel.scale)) {
          console.warn('[scale] missing/invalid glbModel.scale for platform', p.glbName || p.id || p.name || null, ' — defaulting to 1.0');
          modelScale = 1.0;
        }
        const effectiveScale = modelScale * (p.glbScaleMul ?? 1.0);
        const cache = precacheIslandColors(
          p.glbModel.meshData,
          effectiveScale,
          0,  // islands have no yaw rotation
          this._getPlatformPalette(p)
        );
        this._islandCache.set(p, cache);
      } catch (e) {
        console.warn("[precache] failed for platform", i, e);
      }
      this._geomCacheProgress = (i + 1) / total;
    }

    this._geomCacheReady = true;
    console.log(`[precache] Done — ${this._islandCache.size} island caches built.`);
    // Transition to main menu
    if (this.gameState === GAMESTATE.LOADING) this.gameState = GAMESTATE.MENU;
  }

  async _loadBiomeTerrainTextures() {
    const biomeNames = [
      "default",
      "grass",
      "ice",
      "sand",
      "bubblegum",
      "jungle",
      "golden",
      "volcanic",
    ];

    // Phase 2.2: collect every unique zone URL and pack them into ONE CPU
    // texture atlas (single decode + single getImageData; sub-rect views share
    // the buffer for cache locality). Falls back to per-URL loads on failure.
    const urlSet = new Set();
    for (const biome of biomeNames) {
      const zones = getBiomeTextures(biome);
      if (!zones) continue;
      for (const z of ["top", "side", "under", "accent"]) {
        if (zones[z]) urlSet.add(zones[z]);
      }
    }
    let atlasMap = null;
    try {
      atlasMap = await packTextureAtlas([...urlSet], { wrap: true });
    } catch (err) {
      console.warn("[texture] atlas packing failed — per-texture fallback:", err);
    }

    const loadZone = async (url) => {
      if (!url) return null;
      if (atlasMap && atlasMap.get(url)) return atlasMap.get(url);
      try {
        // URLs from textureatlas.js are already absolute CDN URLs — pass them directly.
        // Avoid new URL(url, import.meta.url) which can fail in sandboxed module contexts.
        return await loadTexture(url, { wrap: true });
      } catch (err) {
        console.warn("[texture] biome texture failed — color fallback remains active:", url, err);
        return null;
      }
    };

    for (let i = 0; i < biomeNames.length; i++) {
      const biome = biomeNames[i];
      const zones = getBiomeTextures(biome);
      if (!zones) continue;
      const table = {
        top:    await loadZone(zones.top),
        side:   await loadZone(zones.side),
        under:  await loadZone(zones.under),
        accent: await loadZone(zones.accent),
      };
      this._biomeTextures.set(biome, table);
    }

    console.log("[texture] biome terrain tables loaded", this._biomeTextures.size);
  }

  _getBiomeTextureTable(biome) {
    return this._biomeTextures.get(biome) || this._biomeTextures.get("default") || null;
  }

  // Phase 2.2: load + auto-slice the UI icon sheet (transparent-gutter grid
  // detection). Non-fatal: HUD keeps text labels if this fails.
  async _loadUISprites() {
    try {
      const sheet = await loadSpriteSheet(TEX.ui.icons);
      if (sheet && sheet.sprites.length) {
        this.uiSprites = sheet.sprites;
        console.log(`[ui] icons sliced: ${sheet.sprites.length} sprites (${sheet.cols}x${sheet.rows} grid)`);
      }
    } catch (err) {
      console.warn("[ui] icons spritesheet failed — text labels remain:", err);
    }
  }

  // Async GLB loader — fires once at construction. Loads the five hand-painted
  // animated Froyo models (idle/walk/jump/fall/land) as baked flipbook anims.
  // On success, sets this._froyoAnims + this._froyoMesh; on failure, logs and
  // leaves them null so the billboard fallback keeps rendering.
  async _loadFroyoMesh() {
    try {
      await threeReady();
      const ANIM_URLS = {
        idle: MODEL_URLS.froyo_body,
        walk: MODEL_URLS.froyo_walk,
        jump: MODEL_URLS.froyo_jump,
        fall: MODEL_URLS.froyo_fall,
        land: MODEL_URLS.froyo_land,
      };
      const names = Object.keys(ANIM_URLS);
      const results = await Promise.all(names.map(async (key) => {
        try {
          return await loadGLBAnimation(ANIM_URLS[key], `Froyo ${key}`);
        } catch (err) {
          console.warn(`[geometry] Froyo ${key} anim failed to load:`, err);
          return null;
        }
      }));
      const anims = {};
      names.forEach((key, i) => { if (results[i]) anims[key] = results[i]; });
      if (!anims.idle) {
        console.warn("[geometry] Froyo idle model missing — billboard fallback stays");
        return;
      }

      // ── Auto-normalize to player scale (from the idle rest frame) ────────
      // Compute bounding box so the model fits the physics player height
      // (1.0 world units, feet at player.y - 0.5).
      const verts = anims.idle.frames[0].vertices;
      let minY = Infinity, maxY = -Infinity;
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < verts.length; i += 3) {
        const vx = verts[i], vy = verts[i+1], vz = verts[i+2];
        if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
        if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
        if (vz < minZ) minZ = vz; if (vz > maxZ) maxZ = vz;
      }
      const rawH  = maxY - minY;          // model's native height
      const rawCY = (minY + maxY) * 0.5;  // model's vertical center in local space
      const rawCX = (minX + maxX) * 0.5;
      const rawCZ = (minZ + maxZ) * 0.5;

      // Target height = 1.0 world units (player billboard height).
      // We'll scale the model so it fills exactly that height.
      const TARGET_H = 1.0;
      const autoScale = rawH > 0.0001 ? TARGET_H / rawH : 1.0;

      // After scaling, the model's bottom is at:  rawCY * autoScale - TARGET_H*0.5
      // We want the bottom to sit at player.y - 0.5 (feet).
      // So the worldY offset we pass to buildMeshTris must be:
      //   player.y - 0.5 - (rawCY * autoScale - TARGET_H * 0.5)
      //   = player.y - rawCY * autoScale               (since -0.5 + 0.5 = 0)
      // We store the "centre-offset" so the render call can simply do:
      //   worldY = player.y - _meshCentreOffY
      this._meshAutoScale   = autoScale;
      this._meshCentreOffY  = rawCY * autoScale;  // subtract from player.y to get worldY
      this._meshCentreOffX  = rawCX * autoScale;  // lateral centering
      this._meshCentreOffZ  = rawCZ * autoScale;

      // Shared pivot: stamp the IDLE bbox center on EVERY frame of EVERY anim
      // so all poses rotate/translate around the same point and the feet stay
      // aligned across model swaps.
      for (const key of names) {
        if (!anims[key]) continue;
        for (const frame of anims[key].frames) {
          frame.localCX = rawCX;
          frame.localCY = rawCY;
          frame.localCZ = rawCZ;
        }
      }

      // Front-pip Y: place the muzzle at ~40% up the model (torso level)
      this._meshMuzzleY = -this._meshCentreOffY + (minY + rawH * 0.4) * autoScale;

      this._froyoAnims = anims;
      this._froyoMesh = anims.idle.frames[0];  // keeps muzzle/fallback checks working
      this._animState = { name: "idle", t: 0 };
      this._animWasAirborne = false;
      console.log("[geometry] Froyo anims loaded —",
        names.map((k) => anims[k] ? `${k}:${anims[k].frameCount}f` : `${k}:✗`).join(" "),
        "| textured:", !!anims.idle.texture,
        "| meshTextures:", anims.idle.triTextures ? new Set(anims.idle.triTextures.filter(Boolean)).size : (anims.idle.texture ? 1 : 0),
        "| autoScale:", autoScale.toFixed(3),
        "| centreOffY:", this._meshCentreOffY.toFixed(3));
    } catch (err) {
      console.warn("[geometry] GLB load failed — using billboard fallback:", err);
    }
  }

  // Froyo animation state machine — picks which baked frame to render this
  // tick. Model-swap logic: idle ↔ walk on ground; jump plays once → fall
  // loops while airborne; land plays once on touchdown, then idle/walk.
  _pickFroyoFrame(player) {
    const anims = this._froyoAnims;
    if (!anims || !player) return null;
    const st = this._animState || (this._animState = { name: "idle", t: 0 });

    // Advance anim clock only during live gameplay (freeze on pause/menus).
    if (this.gameState === GAMESTATE.GAMEPLAY) st.t += 1 / 60;

    const airborne = !player.grounded;
    const wasAirborne = this._animWasAirborne;
    this._animWasAirborne = airborne;
    const speed = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
    const moving = speed > 0.02;

    let next = st.name;
    if (airborne) {
      if (st.name === "jump" && anims.jump) {
        // Jump one-shot: hold until the clip finishes, then fall loop.
        if (st.t >= anims.jump.duration) next = "fall";
      } else if (st.name !== "fall") {
        next = (player.vy > 0.01 && anims.jump) ? "jump" : "fall";
      }
    } else if (wasAirborne) {
      next = "land"; // just touched down — land one-shot
    } else if (st.name === "land" && anims.land) {
      // Land one-shot: hold until finished, or break out early if moving.
      if (st.t >= anims.land.duration || moving) next = moving ? "walk" : "idle";
    } else {
      next = moving ? "walk" : "idle";
    }
    if (!anims[next]) next = "idle"; // missing anim → fallback
    if (next !== st.name) { st.name = next; st.t = 0; }

    const anim = anims[st.name] || anims.idle;
    let fi = 0;
    if (anim.frameCount > 1) {
      if (st.name === "jump" || st.name === "land") {
        // One-shots clamp to the last frame.
        fi = Math.min(anim.frameCount - 1, Math.floor((st.t / anim.duration) * anim.frameCount));
      } else {
        // Loops (idle/walk/fall).
        const dur = anim.duration || 1;
        fi = Math.floor(((st.t % dur) / dur) * anim.frameCount) % anim.frameCount;
      }
    }
    return anim.frames[fi] || anim.frames[0];
  }

  // Async loader for the red cherry (muzzle pip replacement)
  async _loadCherryMesh() {
    const GLB_URL = MODEL_URLS.cherry;
    try {
      await threeReady();
      const mesh = await loadGLBMeshIfAvailable(GLB_URL, "Cherry model");
      if (!mesh) return;
      const verts = mesh.vertices;
      let minY = Infinity, maxY = -Infinity;
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < verts.length; i += 3) {
        const vx = verts[i], vy = verts[i+1], vz = verts[i+2];
        if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
        if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
        if (vz < minZ) minZ = vz; if (vz > maxZ) maxZ = vz;
      }
      const rawH = maxY - minY;
      mesh.localCX = (minX + maxX) * 0.5;
      mesh.localCY = (minY + maxY) * 0.5;
      mesh.localCZ = (minZ + maxZ) * 0.5;
      // Scale cherry to fit in a 0.38-unit cube (same size as the old pip)
      const TARGET_H = 0.38;
      this._cherryScale = rawH > 0.0001 ? TARGET_H / rawH : 1.0;
      this._cherryMesh  = mesh;
      console.log("[geometry] Cherry GLB loaded — verts:", mesh.vertices.length / 3, "scale:", this._cherryScale.toFixed(3));
    } catch (err) {
      console.warn("[geometry] Cherry GLB load failed — using cube pip fallback:", err);
    }
  }

  // Async loader for the sprinkle gem collectible (Phase 4.1)
  async _loadSprinkleMesh() {
    const GLB_URL = MODEL_URLS.sprinkle;
    try {
      await threeReady();
      const mesh = await loadGLBMeshIfAvailable(GLB_URL, "Sprinkle model");
      if (!mesh) return;
      const verts = mesh.vertices;
      let minY = Infinity, maxY = -Infinity;
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < verts.length; i += 3) {
        const vx = verts[i], vy = verts[i+1], vz = verts[i+2];
        if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
        if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
        if (vz < minZ) minZ = vz; if (vz > maxZ) maxZ = vz;
      }
      const rawH = maxY - minY;
      mesh.localCX = (minX + maxX) * 0.5;
      mesh.localCY = (minY + maxY) * 0.5;
      mesh.localCZ = (minZ + maxZ) * 0.5;
      const TARGET_H = 0.9;
      this._sprinkleScale = rawH > 0.0001 ? TARGET_H / rawH : 1.0;
      this._sprinkleMesh  = mesh;
      console.log("[geometry] Sprinkle GLB loaded — verts:", mesh.vertices.length / 3, "scale:", this._sprinkleScale.toFixed(3));
    } catch (err) {
      console.warn("[geometry] Sprinkle GLB load failed — using box fallback:", err);
    }
  }

  // Async loader for the sun-with-sunglasses (enemy model)
  async _loadSunMesh() {
    const GLB_URL = MODEL_URLS.sun_enemy;
    try {
      await threeReady();
      const mesh = await loadGLBMeshIfAvailable(GLB_URL, "Sun enemy model");
      if (!mesh) return;
      const verts = mesh.vertices;
      let minY = Infinity, maxY = -Infinity;
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < verts.length; i += 3) {
        const vx = verts[i], vy = verts[i+1], vz = verts[i+2];
        if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
        if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
        if (vz < minZ) minZ = vz; if (vz > maxZ) maxZ = vz;
      }
      const rawH = maxY - minY;
      mesh.localCX = (minX + maxX) * 0.5;
      mesh.localCY = (minY + maxY) * 0.5;
      mesh.localCZ = (minZ + maxZ) * 0.5;
      // Scale sun to match regular enemy display size (~2.8 world units tall)
      const TARGET_H = 2.8;
      this._sunScale      = rawH > 0.0001 ? TARGET_H / rawH : 1.0;
      // Boss sun is 2.5× bigger than regular enemy
      this._sunScaleBoss  = this._sunScale * 2.5;
      this._sunMesh       = mesh;
      console.log("[geometry] Sun GLB loaded — verts:", mesh.vertices.length / 3, "scale:", this._sunScale.toFixed(3));
    } catch (err) {
      console.warn("[geometry] Sun GLB load failed — using billboard fallback:", err);
    }
  }

  // Async loader for SkyDome + SkyboxRing (perimeter sky shells)
  async _loadSkyMeshes() {
    const SKY_DOME_URL = MODEL_URLS.skydome;
    const SKY_RING_URL = MODEL_URLS.skyring;
    try {
      await threeReady();

      // SkyDome — large shell, scaled to encompass entire level (radius ~250 units)
      const domeMesh = await loadGLBMeshIfAvailable(SKY_DOME_URL, "Sky dome model");
      if (domeMesh) {
        const dv = domeMesh.vertices;
        let dMinY = Infinity, dMaxY = -Infinity, dMaxR = 0;
        for (let i = 0; i < dv.length; i += 3) {
          const x = dv[i], y = dv[i+1], z = dv[i+2];
          if (y < dMinY) dMinY = y; if (y > dMaxY) dMaxY = y;
          const r = Math.sqrt(x*x + z*z);
          if (r > dMaxR) dMaxR = r;
        }
        domeMesh.localCX = 0;
        domeMesh.localCY = (dMinY + dMaxY) * 0.5;
        domeMesh.localCZ = 0;
        const SKY_DOME_RADIUS = 260;
        this._skyDomeScale = dMaxR > 0.001 ? SKY_DOME_RADIUS / dMaxR : 1;
        this._skyDomeMesh = domeMesh;
        console.log("[geometry] SkyDome loaded — scale:", this._skyDomeScale.toFixed(2));
      }

      // SkyboxRing — slightly smaller (0.82× of dome radius)
      const ringMesh = await loadGLBMeshIfAvailable(SKY_RING_URL, "Sky ring model");
      if (ringMesh) {
        const rv = ringMesh.vertices;
        let rMinY = Infinity, rMaxY = -Infinity, rMaxR = 0;
        for (let i = 0; i < rv.length; i += 3) {
          const x = rv[i], y = rv[i+1], z = rv[i+2];
          if (y < rMinY) rMinY = y; if (y > rMaxY) rMaxY = y;
          const r = Math.sqrt(x*x + z*z);
          if (r > rMaxR) rMaxR = r;
        }
        ringMesh.localCX = 0;
        ringMesh.localCY = (rMinY + rMaxY) * 0.5;
        ringMesh.localCZ = 0;
        const SKY_RING_RADIUS = 260 * 0.82;
        this._skyRingScale = rMaxR > 0.001 ? SKY_RING_RADIUS / rMaxR : 1;
        this._skyRingMesh = ringMesh;
        console.log("[geometry] SkyboxRing loaded — scale:", this._skyRingScale.toFixed(2));
      }
    } catch (err) {
      console.warn("[geometry] Sky mesh load failed:", err);
    }
  }

  // Async loader for ambient decoration models (land rings, mountains, buildings)
  async _loadAmbientDecoModels() {
    const LAND_RING_URLS = [
      MODEL_URLS.land_ring_a,
      MODEL_URLS.land_ring_b,
      MODEL_URLS.land_ring_c,
    ];
    const MOUNTAIN_URLS = [
      MODEL_URLS.mountain_a,
      MODEL_URLS.mountain_b,
    ];
    const BLDG_URLS = [
      MODEL_URLS.bldg_igloo,
      MODEL_URLS.bldg_stone,
      MODEL_URLS.bldg_wood,
    ];

    const _autoCenter = (mesh) => {
      const v = mesh.vertices;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < v.length; i += 3) {
        if (v[i]   < minX) minX = v[i];   if (v[i]   > maxX) maxX = v[i];
        if (v[i+1] < minY) minY = v[i+1]; if (v[i+1] > maxY) maxY = v[i+1];
        if (v[i+2] < minZ) minZ = v[i+2]; if (v[i+2] > maxZ) maxZ = v[i+2];
      }
      mesh.localCX = (minX + maxX) * 0.5;
      mesh.localCY = (minY + maxY) * 0.5;
      mesh.localCZ = (minZ + maxZ) * 0.5;
      const rawH = maxY - minY;
      const rawR = Math.max(maxX - minX, maxZ - minZ) * 0.5;
      return { rawH, rawR };
    };

    try {
      await threeReady();

      for (const url of LAND_RING_URLS) {
        try {
          const mesh = await loadGLBMeshIfAvailable(url, "LandRing");
          if (mesh) { const bb = _autoCenter(mesh); this._landRingMeshes.push({ mesh, ...bb }); }
        } catch (e) { console.warn("[ambient] LandRing load failed:", e); }
      }

      for (const url of MOUNTAIN_URLS) {
        try {
          const mesh = await loadGLBMeshIfAvailable(url, "Mountain");
          if (mesh) { const bb = _autoCenter(mesh); this._mountainMeshes.push({ mesh, ...bb }); }
        } catch (e) { console.warn("[ambient] Mountain load failed:", e); }
      }

      for (const url of BLDG_URLS) {
        try {
          const mesh = await loadGLBMeshIfAvailable(url, "Building");
          if (mesh) { const bb = _autoCenter(mesh); this._bldgMeshes.push({ mesh, ...bb }); }
        } catch (e) { console.warn("[ambient] Building load failed:", e); }
      }

      this._ambientDecoReady = true;
      this._placeAmbientDecos();
      console.log("[ambient] Deco models loaded:",
        `rings:${this._landRingMeshes.length}`,
        `mountains:${this._mountainMeshes.length}`,
        `bldgs:${this._bldgMeshes.length}`);
    } catch (err) {
      console.warn("[ambient] Failed to load ambient deco models:", err);
    }
  }

  // Generate deterministic placement positions for ambient deco models.
  // Called after ambient models load (or world re-generates).
  _placeAmbientDecos() {
    if (!this._ambientDecoReady) return;
    const placements = [];
    // Simple PRNG using world seed-like value
    let seed = 0xdeadbeef;
    const rng = () => {
      seed = (Math.imul(seed, 0x6d2b79f5) + 0x4f2d1a7b) >>> 0;
      return seed / 0x100000000;
    };

    // Land rings — float at various heights around the outer edge of the world.
    // Kept beyond the outer island band (~138) so they never stack with
    // playable islands.
    const RING_COUNT = 6;
    for (let i = 0; i < RING_COUNT && this._landRingMeshes.length > 0; i++) {
      const entry = this._landRingMeshes[i % this._landRingMeshes.length];
      const angle = (i / RING_COUNT) * Math.PI * 2 + rng() * 0.8;
      const dist  = 200 + rng() * 70;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const y = -5 + rng() * 20;
      const yaw = rng() * 360;
      const TARGET_R = 18 + rng() * 12;
      const scale = entry.rawR > 0.001 ? TARGET_R / entry.rawR : 1;
      placements.push({ mesh: entry.mesh, scale, x, y, z, yaw, colorMode: "island", biome: this._levelBiome || "grass" });
    }

    // Mountains — placed on the horizon, sunken low so only peaks show
    // mountain_B (index 1) is a butte — always desert/sand biome regardless of world biome
    const MTN_COUNT = 4;
    const worldBiome = this._levelBiome || "grass";
    for (let i = 0; i < MTN_COUNT && this._mountainMeshes.length > 0; i++) {
      const meshIdx = i % this._mountainMeshes.length;
      const entry = this._mountainMeshes[meshIdx];
      const angle = (i / MTN_COUNT) * Math.PI * 2 + rng() * 1.2;
      // Horizon only — beyond the outer island band (~138) so peaks never
      // poke up through playable islands.
      const dist  = 180 + rng() * 60;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const y = -entry.rawH * 0.4;  // half-buried
      const yaw = rng() * 360;
      const TARGET_H = 35 + rng() * 20;
      const scale = entry.rawH > 0.001 ? TARGET_H / entry.rawH : 1;
      // mountain_B (butte) is always desert/sand; mountain_A inherits world biome
      const mtnBiome = meshIdx === 1 ? "sand" : worldBiome;
      placements.push({ mesh: entry.mesh, scale, x, y, z, yaw, colorMode: "island", biome: mtnBiome, solid: true });
    }

    // Buildings — placed on/near islands as structural decorations
    const BLDG_COUNT = 8;
    const platforms = this.world?.platforms ?? [];
    const childIslands = platforms.filter(p => p.type === "island" && p.glbModel);
    for (let i = 0; i < BLDG_COUNT && this._bldgMeshes.length > 0 && childIslands.length > 0; i++) {
      const entry  = this._bldgMeshes[i % this._bldgMeshes.length];
      const island = childIslands[i % childIslands.length];
      const ix = island.glbWorldX ?? island.x;
      const iy = island.glbWorldY ?? (island.y - island.sy);
      const iz = island.glbWorldZ ?? island.z;
      const ox = (rng() - 0.5) * (island.sx ?? 10) * 1.2;
      const oz = (rng() - 0.5) * (island.sz ?? 10) * 1.2;
      const x  = ix + ox;
      const y  = iy + (island.topY ?? island.sy ?? 2);
      const z  = iz + oz;
      const yaw = rng() * 360;
      const TARGET_H = 4 + rng() * 4;
      const scale = entry.rawH > 0.001 ? TARGET_H / entry.rawH : 1;
      placements.push({ mesh: entry.mesh, scale, x, y, z, yaw, colorMode: "island", biome: island.biome || this._levelBiome || "grass", solid: true });
    }

    this._ambientDecoPlacements = placements;

    // Register collision for solid decos (mountains, buildings) so the player
    // stands on the SAME triangles the renderer draws.
    this._registerAmbientDecoCollision();
  }

  // Bake a deco placement's mesh into world-aligned collision faces using the
  // EXACT transform buildMeshTris applies when rendering it:
  //   world = rotY(yaw) * ((vert - localC) * scale) + (x, y, z)
  // Yaw + scale are baked into the face array so physics (which only applies
  // glbScaleMul + translation) reproduces the visual geometry 1:1.
  _bakeDecoCollision(deco) {
    const mesh = deco.mesh;
    if (!mesh || !mesh.vertices || !mesh.indices) return null;
    const v = mesh.vertices, idx = mesh.indices;
    const lcx = mesh.localCX ?? 0, lcy = mesh.localCY ?? 0, lcz = mesh.localCZ ?? 0;
    const rad  = ((deco.yaw || 0) * Math.PI) / 180;
    const cosY = Math.cos(rad), sinY = Math.sin(rad);
    const s = deco.scale || 1;
    const faceCount = (idx.length / 3) | 0;
    if (faceCount === 0) return null;
    const faces = new Float32Array(faceCount * 9);
    let maxY = -Infinity, maxAX = 0, maxAZ = 0;
    for (let t = 0; t < faceCount; t++) {
      const base = t * 9;
      for (let k = 0; k < 3; k++) {
        const vi = idx[t * 3 + k] * 3;
        const lx = v[vi] - lcx, ly = v[vi + 1] - lcy, lz = v[vi + 2] - lcz;
        const fx = (lx * cosY + lz * sinY) * s;
        const fy = ly * s;
        const fz = (-lx * sinY + lz * cosY) * s;
        faces[base + k * 3]     = fx;
        faces[base + k * 3 + 1] = fy;
        faces[base + k * 3 + 2] = fz;
        if (fy > maxY) maxY = fy;
        const ax = fx < 0 ? -fx : fx;
        const az = fz < 0 ? -fz : fz;
        if (ax > maxAX) maxAX = ax;
        if (az > maxAZ) maxAZ = az;
      }
    }
    return {
      faces, faceCount,
      topY:  maxY > -Infinity ? maxY : 1,
      halfW: maxAX || 1,
      halfD: maxAZ || 1,
    };
  }

  // (Re)register collision-only platforms for solid ambient decos. Safe to
  // call repeatedly — clears previous ambient_deco entries first, so world
  // regeneration never leaves stale invisible collision behind.
  _registerAmbientDecoCollision() {
    const plats = this.world?.platforms;
    if (!plats) return;
    for (let i = plats.length - 1; i >= 0; i--) {
      if (plats[i].type === "ambient_deco") plats.splice(i, 1);
    }
    let added = 0;
    for (const deco of this._ambientDecoPlacements) {
      if (!deco.solid) continue;
      const col = this._bakeDecoCollision(deco);
      if (!col) continue;
      plats.push({
        x: deco.x, y: deco.y + col.topY, z: deco.z,
        sx: col.halfW, sz: col.halfD, sy: col.topY,
        color: 0xff808080, side: 0xff606060,
        type: "ambient_deco",
        blocks: [],
        collisionOnly: true,   // renderer + precache skip; visuals come from _ambientDecoPlacements
        glbModel: { faces: col.faces, faceCount: col.faceCount, topY: col.topY, scale: 1 },
        glbWorldX: deco.x, glbWorldY: deco.y, glbWorldZ: deco.z,
        glbScaleMul: 1.0,
      });
      added++;
    }
    if (added > 0) console.log(`[ambient] registered collision for ${added} solid deco models`);
  }

  // ── Bridge spline collision (map load) ────────────────────────────────────
  // Bake each bridge plank's rendered ribbon quad (buildFlatSpriteSpan
  // geometry: shared edge point ± spline-perpendicular * plankW) into a
  // collision-only face platform — the SAME GLB face-collision path buildings
  // and mountains use — so the player walks the exact tilted spline surface
  // the renderer draws instead of a flat AABB at deck-center height.
  // Safe to call repeatedly (clears previous bridge_col entries first).
  _registerBridgeCollision() {
    const plats = this.world?.platforms;
    if (!plats) return;
    for (let i = plats.length - 1; i >= 0; i--) {
      if (plats[i].type === "bridge_col") plats.splice(i, 1);
    }
    let added = 0;
    for (const p of plats) {
      if (p.type !== "bridge" || !p.blocks || !p.blocks.length) continue;
      const b = p.blocks[0];
      if (b._e0x === undefined) { p._faceCollision = false; continue; } // legacy plank — keep AABB
      const W = b._plankW;
      // Quad corners — exact match of the rendered span quad.
      const cxs = [
        b._e0x + b._p0x * W, b._e0x - b._p0x * W,
        b._e1x - b._p1x * W, b._e1x + b._p1x * W,
      ];
      const cys = [b._e0y, b._e0y, b._e1y, b._e1y];
      const czs = [
        b._e0z + b._p0z * W, b._e0z - b._p0z * W,
        b._e1z - b._p1z * W, b._e1z + b._p1z * W,
      ];
      const wx = p.x, wz = p.z;
      const wy = Math.min(cys[0], cys[2]) - 0.5; // local origin just below the deck
      // Two triangles per plank quad; verts relative to (wx, wy, wz).
      const TRI = [0, 1, 2, 0, 2, 3];
      const faces = new Float32Array(18);
      let topY = 0.01, hx = 0.4, hz = 0.4;
      for (let k = 0; k < 6; k++) {
        const ci = TRI[k];
        faces[k * 3]     = cxs[ci] - wx;
        faces[k * 3 + 1] = cys[ci] - wy;
        faces[k * 3 + 2] = czs[ci] - wz;
        if (cys[ci] - wy > topY) topY = cys[ci] - wy;
        const ax = Math.abs(cxs[ci] - wx), az = Math.abs(czs[ci] - wz);
        if (ax > hx) hx = ax;
        if (az > hz) hz = az;
      }
      plats.push({
        x: wx, y: wy + topY, z: wz,
        sx: hx, sz: hz, sy: topY,
        color: 0xff808080, side: 0xff606060,
        type: "bridge_col",
        blocks: [],
        collisionOnly: true,  // renderer + precache skip; visuals = flatsprite ribbon
        oneWay: true,         // preserve jump-through-from-below plank behavior
        glbModel: { faces, faceCount: 2, topY, scale: 1 },
        glbWorldX: wx, glbWorldY: wy, glbWorldZ: wz,
        glbScaleMul: 1.0,
      });
      // Face collision now owns this plank — physics skips its flat AABB.
      p._faceCollision = true;
      added++;
    }
    if (added > 0) console.log(`[bridge] registered spline face collision for ${added} planks`);
  }

  // Async loader for the bridge flatsprite texture (textured-plane system).
  // wrap:true — the spline ribbon carries continuous arc-length v coordinates
  // (_v0/_v1 per plank), so the sprite must repeat to tile the whole surface.
  async _loadBridgeTexture() {
    const BRIDGE_SPRITE_URL = null;
    try {
      // cropToContent: trim the sprite's transparent margins so wrap-tiling
      // repeats the plank artwork edge-to-edge (padding tiled = visual gaps).
      const tex = await loadTexture(BRIDGE_SPRITE_URL, { wrap: true, cropToContent: true });
      if (!tex) return;
      this._bridgeTexture = tex;
      console.log("[texture] Bridge flatsprite loaded (cropped):", tex.width + "x" + tex.height);
    } catch (err) {
      console.warn("[texture] Bridge sprite load failed — using plank fallback:", err);
    }
  }

  // Async loader for boot logo GLBs shown on the loading screen.
  // Both meshes are auto-centered and scaled together so they form one
  // cohesive logo at the centre of the screen.
  async _loadBootLogoMeshes() {
    const _autoCenter = (mesh) => {
      const v = mesh.vertices;
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < v.length; i += 3) {
        if (v[i]   < minX) minX = v[i];   if (v[i]   > maxX) maxX = v[i];
        if (v[i+1] < minY) minY = v[i+1]; if (v[i+1] > maxY) maxY = v[i+1];
        if (v[i+2] < minZ) minZ = v[i+2]; if (v[i+2] > maxZ) maxZ = v[i+2];
      }
      mesh.localCX = (minX + maxX) * 0.5;
      mesh.localCY = (minY + maxY) * 0.5;
      mesh.localCZ = (minZ + maxZ) * 0.5;
      return { minY, maxY, rawH: maxY - minY };
    };

    try {
      await threeReady();

      const [frontMesh, backMesh] = await Promise.all([
        loadGLBMeshIfAvailable(MODEL_URLS.boot_front, "BootLogoFront").catch(() => null),
        loadGLBMeshIfAvailable(MODEL_URLS.boot_back,  "BootLogoBack").catch(() => null),
      ]);

      if (!frontMesh && !backMesh) return;  // both failed — use rectangle fallback

      // Compute combined bounding height for the scale that makes the logo
      // roughly 24 world-units tall (screen display is scaled by the camera).
      let combinedMinY = Infinity, combinedMaxY = -Infinity;
      if (frontMesh) {
        const bb = _autoCenter(frontMesh);
        if (bb.minY < combinedMinY) combinedMinY = bb.minY;
        if (bb.maxY > combinedMaxY) combinedMaxY = bb.maxY;
      }
      if (backMesh) {
        const bb = _autoCenter(backMesh);
        if (bb.minY < combinedMinY) combinedMinY = bb.minY;
        if (bb.maxY > combinedMaxY) combinedMaxY = bb.maxY;
      }

      const combinedH = combinedMaxY - combinedMinY;
      const TARGET_H  = 3.2;  // world-units; will be ~30 screen-px at the logo camera distance
      this._bootLogoScale = combinedH > 0.001 ? TARGET_H / combinedH : 1;
      this._bootLogoCY    = ((combinedMinY + combinedMaxY) * 0.5) * this._bootLogoScale;

      this._bootFrontMesh = frontMesh;
      this._bootBackMesh  = backMesh;
      console.log("[bootlogo] GLBs loaded — front:", !!frontMesh, "back:", !!backMesh, "scale:", this._bootLogoScale.toFixed(3));
    } catch (err) {
      console.warn("[bootlogo] Failed to load boot logo meshes:", err);
    }
  }

  // Render the boot logo GLBs into buf32 for the loading screen.
  // Uses a fixed perspective camera aimed at the world origin.
  // cx/baseY are passed for potential future use (screen-space repositioning).
  _renderBootLogoGLB(rd, _cx, _baseY, bobOffset) {
    if (!this._bootFrontMesh && !this._bootBackMesh) return false;

    // Synthetic camera: positioned in front of the logo along -Z axis.
    const logoCam = {
      x: 0, y: this._bootLogoCY + bobOffset * 0.5, z: -8,
      yaw: 0, pitch: 0,
      fovMul: 0.9,
      lookAtX: 0, lookAtY: this._bootLogoCY, lookAtZ: 0,
    };

    // World-space position: centred at (0, 0, 0), bobbing upward by bobOffset.
    const wx = 0, wy = bobOffset, wz = 0;
    const scale = this._bootLogoScale;

    const logoTris = [];

    if (this._bootBackMesh) {
      const t = buildMeshTris(
        this._bootBackMesh,
        wx, wy, wz,
        rgba(245, 180, 80),  // warm golden base colour
        logoCam,
        projectVertex,
        scale,
        0,
        "flat",
        null
      );
      for (const tri of t) logoTris.push(tri);
    }

    if (this._bootFrontMesh) {
      const t = buildMeshTris(
        this._bootFrontMesh,
        wx, wy, wz,
        rgba(245, 100, 140),  // froyo pink face
        logoCam,
        projectVertex,
        scale,
        0,
        "flat",
        null
      );
      for (const tri of t) logoTris.push(tri);
    }

    for (const t of logoTris) {
      drawTri(rd, t.verts[0], t.verts[1], t.verts[2], t.color);
    }

    return true;  // rendered successfully
  }

  start() {
    if (this._running) return;
    this._running = true;
    requestAnimationFrame(this.tick);
  }
  stop() {
    this._running = false;
    this.input.destroy();
    bgmStop();
  }

  // ---- State machine transitions ------------------------------------------
  _enterGameplay() {
    this.gameState = GAMESTATE.GAMEPLAY;
    // Snap camera target to player's initial yaw, then snap to target.
    this.camera.targetYaw = this.player.yaw;
    updateCamera(this.camera, this.player, MOVE.IDLE);
    this.camera.x = this.camera.targetX;
    this.camera.y = this.camera.targetY;
    this.camera.z = this.camera.targetZ;
    this.camera.yaw = this.camera.targetYaw;

    // Ensure imported worlds always have safe array defaults.
    this.world.enemies = Array.isArray(this.world.enemies) ? this.world.enemies : [];
    this.world.platforms = Array.isArray(this.world.platforms) ? this.world.platforms : [];
    this.world.breakables = Array.isArray(this.world.breakables) ? this.world.breakables : [];
    this.world.decorations = Array.isArray(this.world.decorations) ? this.world.decorations : [];
    this.world.windZones = Array.isArray(this.world.windZones) ? this.world.windZones : [];

    if (!this.world.spawn || typeof this.world.spawn.x !== 'number' || typeof this.world.spawn.y !== 'number' || typeof this.world.spawn.z !== 'number') {
      let maxY = 0;
      for (const p of this.world.platforms) {
        const topY = typeof p.y === 'number'
          ? p.y + (typeof p.sy === 'number' ? p.sy : 0)
          : 0;
        if (topY > maxY) maxY = topY;
      }
      this.world.spawn = { x: 0, y: maxY + 5.0, z: 0 };
    }
    if (!this.world.portal || typeof this.world.portal.x !== 'number' || typeof this.world.portal.y !== 'number' || typeof this.world.portal.z !== 'number') {
      this.world.portal = {
        x: 0,
        y: this.world.spawn.y,
        z: 0,
        target: { ...this.world.spawn },
        radius: 1.0,
      };
    } else if (!this.world.portal.target || typeof this.world.portal.target.x !== 'number') {
      this.world.portal.target = { ...this.world.spawn };
    }

    // Sync enemy / portal state on entry
    const alive = this.world.enemies.filter(e => !e.dead);
    this.hud.enemiesLeft = alive.length;
    this.hud.portalOpen  = alive.length === 0;
    flashMessage(this.hud, "SUNDAE ISLES", 90);
    // Start background music on first entry into gameplay
    bgmStart();
  }
  _enterPause() {
    this.gameState = GAMESTATE.PAUSE;
    this._pauseRow = 0;      // 0=Resume, 1=Settings, 2=Main Menu
    this._pausePrevAxisY = 0;
  }
  _resumeFromPause() { this.gameState = GAMESTATE.GAMEPLAY; }
  _enterGameOver() {
    this.gameState = GAMESTATE.GAME_OVER;
    bgmStop();
  }
  _resetGame() {
    // Reset progress FIRST — hub unlocks read hud.sprinkles/worldsCleared.
    this.hud.sprinkles = 0;
    this.hud.lives = 5;
    this.save.sprinkles = 0;
    this.save.lives = 5;
    this.continuesLeft = 2;
    this.save.worldNum = 1;
    this.save.worldsCleared = 0;
    writeSave(this.save);
    this._enterHub();
  }
  // Phase 4.3 — return to the hub (keeps sprinkles/lives/continues)
  _enterHub(flashMsg) {
    this._inHub = true;
    this._pendingWorldNum = null;
    this.world = this._makeHubWorld();
    this._levelBiome = this._resolveLevelBiome(this.world);
    this._applyLevelBiomeDefaults(this.world);
    this._placeAmbientDecos();
    this._registerBridgeCollision();
    this.player = this._newPlayer(this.world.spawn);
    this.camera = createCamera();
    this.breath = createBreathSystem();
    this.transition = createTransition();
    resetProjectiles();
    this._applySkyBiome(this._resolveLevelSkyBiome(this.world) || this._levelBiome);
    this._enterGameplay();
    flashMessage(this.hud, flashMsg || "SUNDAE HUB", 120);
  }
  // Phase 4.3 — warp from a hub portal into playable world n
  _startWorld(n) {
    this._inHub = false;
    this._pendingWorldNum = null;
    this.save.worldNum = n;
    writeSave(this.save);
    // World biome cycles per world number — terrain AND sky travel together
    // (world.js stamps matching `biome`/`skyBiome` tokens on the world).
    this.world = generateWorld(Date.now(), { biome: worldBiomeFor(n) });
    this._levelBiome = this._resolveLevelBiome(this.world);
    this._applyLevelBiomeDefaults(this.world);
    this._placeAmbientDecos();
    this._registerBridgeCollision();
    this.player = this._newPlayer(this.world.spawn);
    this.camera = createCamera();
    this.breath = createBreathSystem();
    this.transition = createTransition();
    resetProjectiles();
    this._applySkyBiome(this._resolveLevelSkyBiome(this.world) || this._levelBiome);
    this._enterGameplay();
    const info = HUB_WORLDS.find(w => w.num === n);
    flashMessage(this.hud, info ? `WORLD ${n}: ${info.name}` : `WORLD ${n}!`, 120);
  }
  _respawn() {
    this.player = this._newPlayer(this.world.spawn);
  }

  // ---- Main tick ----------------------------------------------------------
  tick() {
    if (!this._running) return;
    this.input.sample();
    this.frame++;

    switch (this.gameState) {
      case GAMESTATE.LOADING:     this._tickLoading(); break;
      case GAMESTATE.MENU:        this._tickMenu(); break;
      case GAMESTATE.SETTINGS:    this._tickSettings(); break;
      case GAMESTATE.GAMEPLAY:    this._tickGameplay(); break;
      case GAMESTATE.PAUSE:       this._tickPause(); break;
      case GAMESTATE.INTERMISSION:this._tickIntermission(); break;
      case GAMESTATE.GAME_OVER:   this._tickGameOver(); break;
    }

    requestAnimationFrame(this.tick);
  }

  // ---- LOADING SCREEN -----------------------------------------------------
  // Renders the boot logo GLBs (front + back) when loaded, or falls back
  // to a simple rectangle character. Two progress bars below:
  //   top = island atlas download, bottom = geometry precache.
  _tickLoading() {
    const rd = this.renderer;
    const { buf32, depth } = rd;
    const SW = SCREEN_W, SH = SCREEN_H;

    // Deep-purple background
    buf32.fill(rgba(8, 5, 18));
    depth.fill(Infinity);

    // Sinusoidal bob — shared between the GLB logo and the fallback rectangle
    const t = this.frame * 0.10;
    const bobPx   = Math.abs(Math.sin(t)) * 14;   // 0..14 screen-px of vertical travel
    const squishX = 1 + Math.abs(Math.cos(t)) * 0.18;
    const squishY = 1 - Math.abs(Math.cos(t)) * 0.18;

    const charCX    = SW >> 1;
    const charBaseY = 95;               // vertical midpoint of the splash zone

    // ── GLB boot logo (when loaded) ──────��─────────────────────────────────
    // bobOffset in world-units: the logo camera maps ~0.35 world-units to
    // ~1 screen-pixel at the chosen camera distance, so 14 screen-px ≈ 4.9 wu.
    const bobWorldUnits = (bobPx / 14) * 0.7;
    const glbRendered = this._renderBootLogoGLB(rd, charCX, charBaseY, bobWorldUnits);

    // ── Fallback rectangle character (while GLBs are still loading) ────────
    if (!glbRendered) {
      const charScreenY = charBaseY - bobPx;

      // Shadow (shrinks as character rises)
      const shadowW = Math.max(3, (12 - bobPx * 0.5) | 0);
      const shadowX = charCX - (shadowW >> 1);
      const shadowY = charBaseY + 3;
      for (let py = shadowY; py < shadowY + 2 && py < SH; py++) {
        for (let px = shadowX; px < shadowX + shadowW && px < SW; px++) {
          if (px >= 0) buf32[py * SW + px] = rgba(0, 0, 0);
        }
      }

      // Body gradient — froyo pink (top) → warm orange (bottom)
      const bodyW = Math.max(2, (10 * squishX) | 0);
      const bodyH = Math.max(2, (14 * squishY) | 0);
      const bodyX = charCX - (bodyW >> 1);
      const bodyTopY = (charScreenY - bodyH) | 0;
      const bodyBotC = rgba(250, 190, 80);
      const bodyTopC = rgba(245, 100, 130);
      for (let py = bodyTopY; py < bodyTopY + bodyH && py < SH; py++) {
        if (py < 0) continue;
        const tb = (py - bodyTopY) / Math.max(1, bodyH - 1);
        const rc = ((bodyBotC & 0xff) * tb + (bodyTopC & 0xff) * (1 - tb)) | 0;
        const gc = (((bodyBotC >>> 8) & 0xff) * tb + ((bodyTopC >>> 8) & 0xff) * (1 - tb)) | 0;
        const bc = (((bodyBotC >>> 16) & 0xff) * tb + ((bodyTopC >>> 16) & 0xff) * (1 - tb)) | 0;
        const rowC = rgba(rc, gc, bc);
        for (let px = bodyX; px < bodyX + bodyW && px < SW; px++) {
          if (px >= 0) buf32[py * SW + px] = rowC;
        }
      }

      // Eyes — two white dots
      const eyeY = (bodyTopY + 3) | 0;
      for (let ex = -2; ex <= 2; ex += 4) {
        const epx = charCX + ex;
        if (epx >= 0 && epx < SW && eyeY >= 0 && eyeY < SH) {
          buf32[eyeY * SW + epx] = rgba(255, 255, 255);
          if (eyeY + 1 < SH) buf32[(eyeY + 1) * SW + epx] = rgba(255, 255, 255);
        }
      }
    }

    // Title text — always shown
    const TITLE = "SUNDAE  ISLES";
    const titleW = TITLE.length * 5;
    drawText(rd, TITLE, (SW - titleW) >> 1, 14, rgba(255, 200, 230), 1);

    // Progress bars
    const atlasProgress = getAtlasProgress();
    const geomProgress  = this._geomCacheProgress ?? 0;

    const barW  = 120, barH = 4;
    const bar1Y = charBaseY + 24;
    const bar1X = (SW - barW) >> 1;

    drawText(rd, "LOADING ISLANDS", bar1X, bar1Y - 9, rgba(150, 200, 255), 1);
    drawRect(rd, bar1X, bar1Y, barW, barH, rgba(20, 15, 40));
    drawRect(rd, bar1X, bar1Y, Math.max(1, (atlasProgress * barW) | 0), barH, rgba(100, 200, 255));
    drawRect(rd, bar1X, bar1Y, barW, barH, rgba(60, 120, 200), false);

    const bar2Y = bar1Y + 16;
    drawText(rd, "BAKING  GEOMETRY", bar1X, bar2Y - 9, rgba(150, 255, 180), 1);
    drawRect(rd, bar1X, bar2Y, barW, barH, rgba(20, 15, 40));
    drawRect(rd, bar1X, bar2Y, Math.max(1, (geomProgress * barW) | 0), barH, rgba(80, 220, 140));
    drawRect(rd, bar1X, bar2Y, barW, barH, rgba(40, 140, 80), false);

    // Animated "PLEASE WAIT..." hint
    const dots = ".".repeat(((this.frame >> 3) % 4));
    const hint = "PLEASE WAIT" + dots;
    drawText(rd, hint, (SW - hint.length * 5) >> 1, SH - 10, rgba(100, 80, 140), 1);

    present(rd);
  }

  // ---- MENU ---------------------------------------------------------------
  _tickMenu() {
    const inp = this.input;
    const MENU_COUNT = 7; // Start, Settings, Load Map, Load Froyo, Save, Scene Editor, Reset
    // Vertical navigate
    if (inp.justPressed(BTN_FLAGS.B)) {
      this.menuChoice = (this.menuChoice + 1) % MENU_COUNT;
    }
    const prevAxisY = this._menuPrevAxisY ?? 0;
    const axisY     = inp.axisY;
    if (axisY > 0.4 && prevAxisY <= 0.4)  this.menuChoice = (this.menuChoice + 1) % MENU_COUNT;
    if (axisY < -0.4 && prevAxisY >= -0.4) this.menuChoice = (this.menuChoice + MENU_COUNT - 1) % MENU_COUNT;
    this._menuPrevAxisY = axisY;

    // Confirm
    if (inp.justPressed(BTN_FLAGS.A) || inp.justPressed(BTN_FLAGS.START)) {
      if (this.menuChoice === 0) {
        this._enterGameplay();
      } else if (this.menuChoice === 1) {
        this._enterSettings("MENU");
      } else if (this.menuChoice === 2) {
        if (typeof this.onRequestLoadMap === "function") {
          this.onRequestLoadMap();
        }
      } else if (this.menuChoice === 3) {
        if (typeof this.onRequestLoadFroyo === "function") {
          this.onRequestLoadFroyo();
        }
      } else if (this.menuChoice === 4) {
        this.save.sprinkles = this.hud.sprinkles;
        this.save.lives = this.hud.lives;
        writeSave(this.save);
        downloadFroyoFile(this.save);
      } else if (this.menuChoice === 5) {
        if (typeof this.onRequestSceneEditor === "function") {
          this.onRequestSceneEditor();
        }
      } else if (this.menuChoice === 6) {
        this._resetGame();
      }
    }
    // Render menu
    const rd = this.renderer;
    clearSky(rd, this.frame * 0.5, this.frame);
    const sel = i => (this.menuChoice === i ? "> " : "  ");
    drawCenterPanel(rd, [
      { text: "FROYO  ENGINE", scale: 2, color: rgba(255, 200, 220) },
      { text: "SUNDAE ISLES  V0.2", scale: 1, color: rgba(180, 220, 255) },
      { text: "",   scale: 1 },
      { text: sel(0) + "START GAME",    scale: 1 },
      { text: sel(1) + "SETTINGS",      scale: 1 },
      { text: sel(2) + "LOAD MAP",       scale: 1 },
      { text: sel(3) + "LOAD GAME",    scale: 1 },
      { text: sel(4) + "SAVE  GAME",   scale: 1 },
      { text: sel(5) + "SCENE EDITOR",  scale: 1 },
      { text: sel(6) + "RESET PROGRESS",scale: 1 },
      { text: "",   scale: 1 },
      { text: "A / SPACE: CONFIRM",    scale: 1, color: rgba(180, 180, 200) },
      { text: "B / K: CHANGE OPTION",  scale: 1, color: rgba(180, 180, 200) },
    ]);

    // ── Island atlas loading bar ─────────────────────────────────────────
    // Show while the 3 floating-island GLBs are being processed.
    // Disappears once atlas is fully ready.
    if (!isAtlasReady()) {
      const progress = getAtlasProgress();
      const barW  = 120;
      const barH  = 5;
      const barX  = (SCREEN_W - barW) >> 1;
      const barY  = SCREEN_H - 18;

      const LABEL      = "LOADING ISLANDS...";
      const labelW     = LABEL.length * 5;
      const labelX     = (SCREEN_W - labelW) >> 1;
      const labelColor = rgba(150, 200, 255);
      drawText(rd, LABEL, labelX, barY - 8, labelColor, 1);

      const BG_COLOR   = rgba(30,  25, 55);
      const FILL_COLOR = rgba(100, 210, 255);
      const EDGE_COLOR = rgba(80,  160, 220);
      drawRect(rd, barX, barY, barW, barH, BG_COLOR);
      const fillW = Math.max(1, Math.round(progress * barW));
      drawRect(rd, barX, barY, fillW, barH, FILL_COLOR);
      drawRect(rd, barX, barY, barW, barH, EDGE_COLOR, false);

      // Animated fill shimmer — a 2-pixel-wide bright stripe that scrolls
      const shimX = barX + ((this.frame * 2) % barW);
      if (shimX < barX + fillW) {
        drawRect(rd, shimX, barY, 2, barH, rgba(200, 240, 255));
      }
    }

    present(rd);
  }

  // ---- SETTINGS (shared by main menu and pause) ---------------------------
  _enterSettings(returnTo = "MENU") {
    this._settingsReturnTo = returnTo; // "MENU" or "PAUSE"
    this._settingsRow  = 0;
    this._settingsFxVol  = sfxGetVolume();
    this._settingsBgmVol = bgmGetVolume();
    this._settingsHeld   = 0;
    this._settingsPrevAxisX = 0;
    this._settingsPrevAxisY = 0;
    this.gameState = GAMESTATE.SETTINGS;
  }

  _tickSettings() {
    const inp   = this.input;
    const ROWS  = 3; // 0=FX Vol, 1=Music Vol, 2=Back

    // Axis edge detect
    const prevY = this._settingsPrevAxisY ?? 0;
    const prevX = this._settingsPrevAxisX ?? 0;
    const axY   = inp.axisY;
    const axX   = inp.axisX;
    const justDown  = axY >  0.4 && prevY <=  0.4;
    const justUp    = axY < -0.4 && prevY >= -0.4;
    const justRight = axX >  0.4 && prevX <=  0.4;
    const justLeft  = axX < -0.4 && prevX >= -0.4;
    this._settingsPrevAxisY = axY;
    this._settingsPrevAxisX = axX;

    // Navigate rows
    if (justDown || inp.justPressed(BTN_FLAGS.B))  this._settingsRow = (this._settingsRow + 1) % ROWS;
    if (justUp)                                     this._settingsRow = (this._settingsRow + ROWS - 1) % ROWS;

    // Confirm / back — pressing Start always goes back; A on BACK row also goes back
    const confirmBack = inp.justPressed(BTN_FLAGS.START) ||
                        (inp.justPressed(BTN_FLAGS.A) && this._settingsRow === 2);
    if (confirmBack) {
      this._saveAudioSettings();
      this.gameState = this._settingsReturnTo === "PAUSE" ? GAMESTATE.PAUSE : GAMESTATE.MENU;
      return;
    }

    // Slider adjust with auto-repeat
    const hDir = axX > 0.4 ? 1 : axX < -0.4 ? -1 : 0;
    hDir !== 0 ? this._settingsHeld++ : (this._settingsHeld = 0);
    const fire = (justLeft || justRight) ||
                 this._settingsHeld === 1 ||
                 (this._settingsHeld > 20 && this._settingsHeld % 5 === 0);

    if (fire && hDir !== 0 && this._settingsRow < 2) {
      const step = 0.05;
      if (this._settingsRow === 0) {
        this._settingsFxVol = Math.max(0, Math.min(1, this._settingsFxVol + hDir * step));
        sfxSetVolume(this._settingsFxVol);
        sfxCollect();
      } else {
        this._settingsBgmVol = Math.max(0, Math.min(1, this._settingsBgmVol + hDir * step));
        bgmSetVolume(this._settingsBgmVol);
      }
    }

    // Render
    const rd = this.renderer;
    clearSky(rd, this.frame * 0.5, this.frame);
    this._drawSettingsPanel(false);
    present(rd);
  }

  _saveAudioSettings() {
    this.save.fxVolume  = sfxGetVolume();
    this.save.bgmVolume = bgmGetVolume();
    writeSave(this.save);
  }

  // ---- PAUSE --------------------------------------------------------------
  _tickPause() {
    const inp = this.input;
    const ROWS = 4; // 0=Resume, 1=Settings, 2=Main Menu, (no inline sliders — use Settings)

    // ── Edge-detect axis inputs ──────────────────────────────────────────────
    const prevAxisY = this._pausePrevAxisY ?? 0;
    const axisY     = inp.axisY;
    const justDown  = axisY >  0.4 && prevAxisY <=  0.4;
    const justUp    = axisY < -0.4 && prevAxisY >= -0.4;
    this._pausePrevAxisY = axisY;

    // ── Navigation (up/down) ──────────────────────────────────────────────
    if (justDown || inp.justPressed(BTN_FLAGS.B)) this._pauseRow = (this._pauseRow + 1) % ROWS;
    if (justUp)                                    this._pauseRow = (this._pauseRow + ROWS - 1) % ROWS;

    // ── Confirm (A / Start) ───────────────────────────────────────────────
    if (inp.justPressed(BTN_FLAGS.A) || inp.justPressed(BTN_FLAGS.START)) {
      if (this._pauseRow === 0) { this._resumeFromPause(); return; }
      if (this._pauseRow === 1) { this._enterSettings("PAUSE"); return; }
      if (this._pauseRow === 2) { this._saveAudioSettings(); this.gameState = GAMESTATE.MENU; bgmStop(); return; }
      if (this._pauseRow === 3) { this._resumeFromPause(); return; } // extra resume row
    }

    // ── Render ────────────────────────────────────────────────────────────
    this._renderScene(true);
    this._drawPauseMenu();
    present(this.renderer);
  }

  _drawPauseMenu() {
    const rd = this.renderer;

    const W = 100, H = 60;
    const px = (SCREEN_W - W) >> 1;
    const py = (SCREEN_H - H) >> 1;

    const PANEL  = rgba(20,  14,  36);
    const ACCENT = rgba(255, 110, 180);
    const WHITE  = rgba(255, 255, 255);
    const DIM    = rgba(140, 120, 160);
    const SEL    = rgba(120, 240, 200);

    drawRect(rd, px, py, W, H, PANEL);
    drawRect(rd, px, py, W, H, ACCENT, false);

    // Title
    const TITLE = "PAUSED";
    const titleW = TITLE.length * 5;
    drawText(rd, TITLE, px + ((W - titleW) >> 1), py + 5, ACCENT, 1);

    const items = ["RESUME GAME", "SETTINGS", "MAIN MENU"];
    let ry = py + 17;
    for (let i = 0; i < items.length; i++) {
      const s = i === this._pauseRow;
      if (s) drawText(rd, ">", px + 4, ry, SEL, 1);
      drawText(rd, items[i], px + 12, ry, s ? SEL : WHITE, 1);
      ry += 11;
    }

    const hint = "W/S:SEL  SPC:OK";
    const hw   = hint.length * 5;
    drawText(rd, hint, px + ((W - hw) >> 1), py + H - 8, DIM, 1);
  }

  // ---- SETTINGS panel (standalone screen, reachable from Menu and Pause) --
  _drawSettingsPanel(overlay) {
    const rd = this.renderer;

    const W = 130, H = 72;
    const px = (SCREEN_W - W) >> 1;
    const py = (SCREEN_H - H) >> 1;

    const PANEL       = rgba(20,  14,  36);
    const ACCENT      = rgba(255, 110, 180);
    const WHITE       = rgba(255, 255, 255);
    const DIM         = rgba(140, 120, 160);
    const SEL         = rgba(120, 240, 200);
    const SLIDER_FILL = rgba(100, 220, 180);
    const SLIDER_BG   = rgba(50,  40,  70);
    const SLIDER_DIM  = rgba(60,  150, 120);

    drawRect(rd, px, py, W, H, PANEL);
    drawRect(rd, px, py, W, H, ACCENT, false);

    const TITLE = "SETTINGS";
    const titleW = TITLE.length * 5;
    drawText(rd, TITLE, px + ((W - titleW) >> 1), py + 4, ACCENT, 1);

    const items = [
      { label: "FX VOL",  val: this._settingsFxVol  },
      { label: "BGM VOL", val: this._settingsBgmVol },
    ];

    let ry = py + 16;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const s    = i === this._settingsRow;
      const lc   = s ? SEL : DIM;
      if (s) drawText(rd, ">", px + 3, ry, SEL, 1);
      drawText(rd, item.label, px + 10, ry, lc, 1);

      const sx  = px + 10;
      const sy  = ry + 9;
      const sw  = W - 28;
      const sh  = 4;
      drawRect(rd, sx, sy, sw, sh, SLIDER_BG);
      const fillW = Math.max(2, Math.round(item.val * sw));
      drawRect(rd, sx, sy, fillW, sh, s ? SLIDER_FILL : SLIDER_DIM);
      drawRect(rd, sx, sy, sw, sh, s ? SEL : DIM, false);
      const pct    = Math.round(item.val * 100);
      const pctStr = String(pct).padStart(3, " ") + "%";
      drawText(rd, pctStr, sx + sw + 2, sy, s ? SEL : DIM, 1);
      ry += 18;
    }

    // Back row
    {
      const s = this._settingsRow === 2;
      if (s) drawText(rd, ">", px + 3, ry, SEL, 1);
      drawText(rd, "BACK", px + 10, ry, s ? SEL : WHITE, 1);
    }

    const hint = "W/S:SEL  A/D:ADJ  SPC:BACK";
    const hw   = hint.length * 5;
    drawText(rd, hint, px + ((W - hw) >> 1), py + H - 8, DIM, 1);
  }

  // ---- INTERMISSION (portal warp animation) -------------------------------
  _tickIntermission() {
    const still = stepTransition(this.transition, this.player);
    this._renderScene(false);
    const { warp, fade } = transitionWarpAmount(this.transition);
    present(this.renderer, warp, fade);
    if (!still) {
      // Phase 4.3 — hub portal warps into its world; level portal warps home
      if (this._pendingWorldNum) this._startWorld(this._pendingWorldNum);
      else this._enterHub();
    }
  }

  // ---- GAME OVER ----------------------------------------------------------
  _tickGameOver() {
    const canContinue = (this.continuesLeft ?? 0) > 0;
    if (this.input.justPressed(BTN_FLAGS.A) && canContinue) {
      // Continue: burn one continue, restore 5 lives, respawn on same world
      this.continuesLeft--;
      notifyLives(this.hud, 5);
      this.save.lives = 5;
      writeSave(this.save);
      this._enterHub(); // Phase 4.3 — continue restarts from the hub
    } else if (
      this.input.justPressed(BTN_FLAGS.START) ||
      (this.input.justPressed(BTN_FLAGS.A) && !canContinue)
    ) {
      this._resetGame();
    }
    this._renderScene(true);
    const lines = [
      { text: "GAME OVER", scale: 2, color: rgba(255, 100, 120) },
      { text: "", scale: 1 },
      { text: `SPRINKLES: ${this.hud.sprinkles}`, scale: 1 },
      { text: "", scale: 1 },
    ];
    if (canContinue) {
      lines.push({ text: `A: CONTINUE (${this.continuesLeft} LEFT)`, scale: 1, color: rgba(180, 255, 190) });
      lines.push({ text: "START: NEW GAME", scale: 1, color: rgba(200, 200, 220) });
    } else {
      lines.push({ text: "PRESS START TO RETRY", scale: 1, color: rgba(200, 200, 220) });
    }
    drawCenterPanel(this.renderer, lines);
    present(this.renderer);
  }

  // ---- GAMEPLAY -----------------------------------------------------------
  // ---- DEBUG FLYCAM (Phase 2.1) -------------------------------------------
  // Free camera for level inspection. World simulation is frozen; the scene
  // renders as a static frame from the flycam's point of view.
  _tickFlycam() {
    const inp = this.input;
    stepFlycam(this._flycam, inp);
    applyFlycamToCamera(this._flycam, this.camera);
    this._renderScene(true);

    const rd = this.renderer;
    const f = this._flycam;
    drawText(rd, "FLYCAM", 4, 4, rgba(255, 220, 120), 1);
    drawText(
      rd,
      `X ${f.x | 0}  Y ${f.y | 0}  Z ${f.z | 0}  YAW ${f.yaw | 0}  PIT ${f.pitch | 0}`,
      4, 12, rgba(200, 200, 220), 1
    );
    drawText(
      rd,
      "WASD MOVE QE YAW RV PITCH SPC/CTL UP/DN SHIFT FAST F EXIT",
      4, 192, rgba(150, 150, 170), 1
    );
    present(rd);
  }

  _tickGameplay() {
    const inp = this.input;
    const player = this.player;
    const world = this.world;

    // Pause hotkey
    if (inp.justPressed(BTN_FLAGS.START)) {
      this._enterPause();
      return;
    }
    // Debug flycam (Phase 2.1): F toggles. World freezes while flying.
    if (inp.keyJustPressed?.("KeyF")) {
      this._flycamOn = !this._flycamOn;
      if (this._flycamOn) this._flycam = createFlycam(this.camera);
    }
    if (this._flycamOn && this._flycam) {
      this._tickFlycam();
      return;
    }
    // Debug toggle: hold SEL
    this.debugOpen = inp.isDown(BTN_FLAGS.SEL);

    // ---- 1. Input → derive request flags (jump trigger captured here) ----
    if (inp.justPressed(BTN_FLAGS.A)) {
      // request handled in physics on next step (so we can drive impulses)
      player._wantJump = true;
      // Sound: first jump vs double-jump based on current token count
      if (player.jumpTokens === 2) sfxJump();
      else if (player.jumpTokens === 1) sfxDoubleJump();
    }
    // Variable jump height: releasing A while rising trims the arc (physics
    // applies the cut; tap = short hop, hold = full jump).
    if (inp.justReleased(BTN_FLAGS.A)) {
      player._wantJumpCut = true;
    }

    // ---- Glide arm tracking -----------------------------------------------
    // _glideArmed latches true the moment A is held after both jump tokens are
    // spent (jumpTokens === 0), and stays true until the player lands.
    // This gates glide so it only engages on intentional hold.
    if (player.grounded) {
      player._glideArmed = false; // reset every landing
    } else if (player.jumpTokens === 0) {
      // Both tokens spent — window is open: arm glide if A held at any point.
      if (inp.isDown(BTN_FLAGS.A)) {
        player._glideArmed = true;
      }
    }

    // ---- 2. Bitwise resolution ------------------------------------------
    const justLanded = player.grounded && (player.state & (STATE.JUMP | STATE.DOUBLE_JUMP));
    const grounded = player.grounded;
    player.state = resolveBitwise(player.state, {
      input: inp,
      grounded,
      justLanded,
      axisX: inp.axisX,
      axisY: inp.axisY,
      jumpTokens: player.jumpTokens,
      glideArmed: player._glideArmed,
    });

    // ---- 3. Discrete resolution -----------------------------------------
    const { movementMode, jumpMode } = resolveDiscrete(player.state, grounded);

    // ---- 4. LUT execution -----------------------------------------------
    // Track grounded transition for squash/stretch BEFORE physics overwrites it.
    const wasGrounded = player.grounded;
    const yVelPreLand = player.vy;

    // Camera yaw control: locked-behind-player by default, free-orbit while
    // any free-cam input is engaged (Q/E keys, right-stick X, LB/RB shoulders).
    {
      let orbitDelta = inp.orbitX;
      if (inp.isDown(BTN_FLAGS.LB)) orbitDelta -= 1;
      if (inp.isDown(BTN_FLAGS.RB)) orbitDelta += 1;
      const freeCam = Math.abs(orbitDelta) > 0.01;
      if (freeCam) {
        this.camera.targetYaw += orbitDelta * 2.5;
      } else {
        let dy = player.yaw - this.camera.targetYaw;
        if (dy > 180) dy -= 360;
        if (dy < -180) dy += 360;
        this.camera.targetYaw += dy * 0.18;
      }
      if (this.camera.targetYaw < 0) this.camera.targetYaw += 360;
      if (this.camera.targetYaw >= 360) this.camera.targetYaw -= 360;
    }

    // Camera pitch override: right-stick Y (gamepad) accumulates into
    // camera.lookPitch (clamped). When no input, it decays back to 0 so
    // the auto-pitch resumes. Composed targetPitch clamped to ±40°.
    {
      const stickPitch = inp.orbitY;       // -1..+1
      // Invert stick: pulling stick UP (-y) should look UP (+pitch).
      const stickDelta = -stickPitch * 2.0;
      const inputActive = Math.abs(stickPitch) > 0.05;
      if (inputActive) {
        this.camera.lookPitch += stickDelta;
      } else {
        this.camera.lookPitch *= 0.90; // ease back toward auto-aim
        if (Math.abs(this.camera.lookPitch) < 0.05) this.camera.lookPitch = 0;
      }
      if (this.camera.lookPitch > 30) this.camera.lookPitch = 30;
      if (this.camera.lookPitch < -30) this.camera.lookPitch = -30;
    }

    // Cast a ray from Froyo's muzzle along her facing direction.
    // The hit point (platform surface or max-range endpoint) becomes the
    // smooth look-at target; autoPitch is then derived from camera → that point.
    castLookRay(this.camera, player, world.platforms);

    updateCamera(this.camera, player, movementMode, 1, world.platforms);

    // Compose final targetPitch after updateCamera produced autoPitch.
    {
      let p = this.camera.autoPitch + this.camera.lookPitch;
      if (p > 40)  p = 40;
      if (p < -40) p = -40;
      this.camera.targetPitch = p;
    }

    // Step moving platforms before physics so collision is up-to-date
    const movingPlatforms = stepMovingPlatforms(world, this.frame);

    // Platform carry — if player is grounded on a moving platform, push them
    // with the platform's velocity delta so they ride it naturally.
    if (player.grounded && movingPlatforms.length > 0) {
      const r = 0.35; // player radius (must match physics.js)
      const halfH = 0.5;
      for (const p of movingPlatforms) {
        // Check if player is standing on top of this specific platform
        let onThisPlatform = false;
        for (const b of p.blocks) {
          if (b.sx === undefined) continue;
          const dx = player.x - b.wx;
          const dz = player.z - b.wz;
          const topY = b.wy + b.sy;
          const bottomY = b.wy - b.sy;
          if (Math.abs(dx) <= b.sx + r + 0.05 &&
              Math.abs(dz) <= b.sz + r + 0.05 &&
              Math.abs(player.y - halfH - topY) < 0.12) {
            onThisPlatform = true;
            break;
          }
        }
        if (!onThisPlatform) {
          // Also check platform AABB for single-block platforms
          const dx = player.x - p.x;
          const dz = player.z - p.z;
          const topY = p.y;
          if (Math.abs(dx) <= p.sx + r + 0.05 &&
              Math.abs(dz) <= p.sz + r + 0.05 &&
              Math.abs(player.y - halfH - topY) < 0.12) {
            onThisPlatform = true;
          }
        }
        if (onThisPlatform) {
          player.x += p.dvx;
          player.z += p.dvz;
          break; // only one platform at a time
        }
      }
    }

    // Apply wind gust force — currently disabled while wind obstacles are paused.
    if (false && world.windZones && !player.grounded) {
      for (const wz of world.windZones) {
        const wdx = player.x - wz.x;
        const wdz = player.z - wz.z;
        const wdist = Math.sqrt(wdx * wdx + wdz * wdz);
        if (wdist < wz.radius) {
          const falloff = 1 - wdist / wz.radius;
          // Wind direction vector from angle
          const wvx = Math.sin(wz.angle);
          const wvz = Math.cos(wz.angle);
          player.vx += wvx * wz.strength * falloff;
          player.vz += wvz * wz.strength * falloff;
          // Visual cue: store "in wind" flag for HUD
          if (!this._windNotified && falloff > 0.5) {
            flashMessage(this.hud, "WIND!", 45);
            sfxWind();
            this._windNotified = true;
          }
        } else {
          this._windNotified = false;
        }
      }
    }

    stepPhysics(player, world, {
      axisX: inp.axisX,
      axisY: inp.axisY,
      movementMode,
      jumpMode,
    });

    // Track player angular velocity for the turn-lean animation.
    {
      let dy = player.yaw - player._prevYaw;
      if (dy > 180) dy -= 360;
      if (dy < -180) dy += 360;
      player.yawVel = player.yawVel * 0.65 + dy * 0.35;
      player._prevYaw = player.yaw;
    }

    // Squash & stretch driver (anim only — purely visual)
    {
      const landedThisFrame = !wasGrounded && player.grounded;
      if (landedThisFrame && yVelPreLand < -0.18) {
        // Sharp downward landing → squash + thud sound
        player.squash = -0.55;
        sfxLand(-yVelPreLand);
      } else if (!player.grounded && player.vy > 0.10) {
        // Ascending fast → stretch
        const target = 0.35;
        player.squash += (target - player.squash) * 0.30;
      } else {
        player.squash *= 0.78;
        if (Math.abs(player.squash) < 0.01) player.squash = 0;
      }
    }

    // Ice breath trigger — fires from the player's front muzzle along player.yaw.
    if (inp.justPressed(BTN_FLAGS.X)) {
      fireBreath(this.breath, player, world, player.yaw);
      this.input.rumble({ duration: 120, strongMagnitude: 0.3, weakMagnitude: 0.6 });
      sfxIceBreath();
    }
    stepBreath(this.breath);
    stepBreakables(world);

    // Sound: crystal shatter
    for (const c of world.crystals) {
      if (c.broken && !c._rewarded) {
        c._rewarded = true;
        this._awardSprinkles(c.reward ?? 10);
        sfxCrystalBreak();
        sfxCollect();
      }
    }

    // Sprinkle gem / 1-UP collection (Phase 4.1)
    if (world.gems && world.gems.length) {
      const got = stepGems(world, player);
      for (const g of got) {
        if (g.type === "life") {
          notifyLives(this.hud, this.hud.lives + 1);
          this.save.lives = this.hud.lives;
          writeSave(this.save);
          flashMessage(this.hud, "1-UP!", 90);
          sfxCollect();
        } else {
          this._awardSprinkles(1);
          sfxCollect();
        }
      }
      let gTotal = 0, gGot = 0;
      for (const g of world.gems) {
        if (g.type === "gem") { gTotal++; if (g.taken) gGot++; }
      }
      this.hud.gemsTotal = gTotal;
      this.hud.gemsGot = gGot;
      if (gTotal > 0 && gGot === gTotal && !world._gemsCleared) {
        world._gemsCleared = true;
        flashMessage(this.hud, "ALL SPRINKLES! +50", 120);
        this._awardSprinkles(50);
      }
    } else {
      this.hud.gemsTotal = 0;
      this.hud.gemsGot = 0;
    }

    // Sound: crate break
    if (world.breakables) {
      for (const b of world.breakables) {
        if (b.broken && !b._soundPlayed) {
          b._soundPlayed = true;
          sfxCrateBreak();
        }
      }
    }

    // ---- Enemy AI tick ------------------------------------------------
    // Count projectiles fired this frame so we can play shoot SFX
    const projBefore = projectiles.length;
    stepEnemyAI(world.enemies, player, world.platforms, this.frame, this.hud, flashMessage);
    if (projectiles.length > projBefore) sfxEnemyShoot();

    // Frozen/death SFX — flag-based so breath-caused freezes/shatters count too
    for (const e of world.enemies) {
      if (e.frozen && !e._frozenSfx) { e._frozenSfx = true; sfxEnemyFrozen(); }
      if (!e.frozen) e._frozenSfx = false;
      if (e.dead && !e._deathNotified) {
        e._deathNotified = true;
        sfxEnemyDie();
        if (e.boss) {
          // Boss defeat sequence: banner + big 50-sprinkle gem drop
          flashMessage(this.hud, "BOSS DOWN!", 120);
          world.crystals.push({ x: e.x, y: e.y, z: e.z, broken: false, shatterT: 0, reward: 50, big: true });
        }
      }
    }

    // Hazards: spikes / lava pads / crush traps
    stepHazards(world, player, this.frame, this.hud, flashMessage);

    // Damage invincibility frames tick down (Phase 4.2)
    if (player.invulnT > 0) player.invulnT--;

    // Player hit-stun from projectiles (hitT ticked down each frame)
    if (player.hitT > 0) {
      player.hitT--;
      if (player.hitT === 44) {
        // First frame of hit — apply STATE.HIT, lose 1 HP, grant i-frames
        player.state |= STATE.HIT;
        player.hp = Math.max(0, (player.hp ?? 1) - 1);
        player.invulnT = 90;
        sfxPlayerHit();
        this.input.rumble({ duration: 200, strongMagnitude: 0.8, weakMagnitude: 0.4 });
        if (player.hp <= 0) {
          // Out of hearts — lose a life
          notifyLives(this.hud, this.hud.lives - 1);
          this.save.lives = this.hud.lives;
          writeSave(this.save);
          if (this.hud.lives <= 0) {
            this._enterGameOver();
            return;
          }
          if (world.isHub) {
            this._respawn(); // hub deaths are free respawns
          } else {
            this._enterHub("BACK TO THE HUB!"); // Phase 4.3
            return;
          }
        }
      }
    } else {
      player.state &= ~STATE.HIT; // clear HIT flag when stun ends
    }

    // ---- Enemy defeat tracking ------------------------------------------
    // Count living enemies; detect when the last one just died this frame.
    const aliveEnemies = world.enemies.filter(e => !e.dead);
    const prevPortalOpen = this.hud.portalOpen;
    this.hud.enemiesLeft = aliveEnemies.length;
    this.hud.portalOpen  = aliveEnemies.length === 0;

    // Flash a message exactly once when the portal unlocks
    if (!prevPortalOpen && this.hud.portalOpen && world.enemies.length > 0) {
      flashMessage(this.hud, "PORTAL OPEN!", 120);
      sfxPortalOpen();
    }

    // Portal interaction — Phase 4.3: hub portals select a world; a level's
    // portal (open once all enemies die) banks progress and returns to hub.
    if (world.isHub) {
      if (this._lockedFlashT > 0) this._lockedFlashT--;
      for (const p of world.hubPortals) {
        if (!p.locked) {
          const gate = { x: p.x, y: p.y, z: p.z, radius: p.radius, target: world.spawn };
          if (tryPortal(this.transition, player, gate)) {
            this._pendingWorldNum = p.worldNum;
            this.gameState = GAMESTATE.INTERMISSION;
            break;
          }
        } else {
          const dx = player.x - p.x, dy = player.y - p.y, dz = player.z - p.z;
          const r = p.radius * 1.6;
          if (dx * dx + dy * dy + dz * dz < r * r && this._lockedFlashT <= 0) {
            this._lockedFlashT = 90;
            const needClear = (this.save.worldsCleared ?? 0) < p.worldNum - 1;
            flashMessage(this.hud, needClear
              ? `CLEAR WORLD ${p.worldNum - 1} FIRST`
              : `NEED ${p.reqSprinkles} SPRINKLES`, 90);
          }
        }
      }
    } else if (this.hud.portalOpen && tryPortal(this.transition, player, world.portal)) {
      // Level cleared — bank progress; intermission returns to the hub
      this.save.worldsCleared = Math.max(this.save.worldsCleared ?? 0, this.save.worldNum || 1);
      writeSave(this.save);
      this._pendingWorldNum = null;
      this.gameState = GAMESTATE.INTERMISSION;
    }

    // Death handling — bottom of world. Hub deaths respawn free; level
    // deaths cost a life and send you back to the hub (Phase 4.3).
    if (player.state & STATE.DEAD) {
      if (world.isHub) {
        this._respawn();
      } else {
        if (this.hud.lives > 0) {
          notifyLives(this.hud, this.hud.lives - 1);
          this.save.lives = this.hud.lives;
          writeSave(this.save);
        }
        if (this.hud.lives <= 0) {
          this._enterGameOver();
          return;
        }
        this._enterHub("BACK TO THE HUB!");
        return;
      }
    }

    // Sync health into the HUD (Phase 4.2)
    this.hud.hp = this.player.hp ?? 3;
    this.hud.maxHp = this.player.maxHp ?? 3;

    tickHUD(this.hud);

    // ---- 5. Render ------------------------------------------------------
    this._renderScene(false, { movementMode, jumpMode });
    present(this.renderer);
  }

  // ---- Render the scene (no present) -------------------------------------
  _renderScene(staticFrame, modes = null) {
    const rd = this.renderer;
    const cam = this.camera;
    const world = this.world;
    const player = this.player;

    // Sync Three.js camera matrices before any GLB mesh projection this frame
    syncThreeCamera(cam);

    clearSky(rd, cam.yaw, this.frame);

    // Build all triangles
    const tris = [];

    // Helper: push an axis-aligned box (pure-JS, no Three.js)
    const pushBox = (cx, cy, cz, sx, sy, sz, top, side) => {
      const arr = buildCube(cx, cy, cz, sx, sy, sz, top, side, cam);
      for (const t of arr) tris.push(t);
    };

    // pushBoxCulled — no frustum check, back-face culling happens in buildCube
    const pushBoxCulled = (cx, cy, cz, sx, sy, sz, top, side, _r) => {
      pushBox(cx, cy, cz, sx, sy, sz, top, side);
    };

    // ── SkyDome + SkyboxRing — encompass the level perimeter ────────────────
    // Both are centered on the camera (parallax: they rotate WITH the camera yaw
    // so they appear stationary — a classic skybox trick). SkyDome gets a purple→orange
    // gradient tint; SkyboxRing is slightly smaller.
    // We render them before everything else so they sit behind all geometry.
    if (this._skyDomeMesh) {
      // Lerp tint from purple (top) to orange (horizon) based on each triangle's
      // average Y. We pass baseColor = orange and use the "skyGradient" colorMode
      // handled in geometry.js — but since we don't have that mode yet, we use
      // a warm orange-purple blend as baseColor and let lighting do the rest.
      const SKY_DOME_TINT = rgba(220, 100, 60);   // warm orange-purple
      const skyDomeTris = buildMeshTris(
        this._skyDomeMesh,
        cam.x, cam.y, cam.z,       // follow camera
        SKY_DOME_TINT,
        cam,
        projectVertex,
        this._skyDomeScale,
        cam.yaw,                   // rotate with camera yaw → parallax
        "skyDome",                 // custom colorMode for sky gradient
        this._getSkyPalette()
      );
      for (const t of skyDomeTris) tris.push(t);
    }
if (this._skyRingMesh) {

const sky =
    this._getSkyPalette();

const ringSide =
    sky.ringSide ||
    sky.side ||
    sky.fog ||
    [110, 110, 140];

const SKY_RING_TINT =
    rgba(
        ringSide[0],
        ringSide[1],
        ringSide[2],
    );

  const skyRingTris = buildMeshTris(
      this._skyRingMesh,
      cam.x, cam.y, cam.z,
      SKY_RING_TINT,
      cam,
      projectVertex,
      this._skyRingScale,
      0,
      "skyRing",
      sky
  );

  for (let i = 0; i < skyRingTris.length; i++) {
      tris.push(
          skyRingTris[i]
      );
  }
}
    // Void/water plane below islands — rendered before all geometry so it sits behind
    {
      const voidY = -22;
      const voidTris = buildVoidPlane(voidY, this.frame, cam);
      for (const t of voidTris) tris.push(t);
    }

    // Moving platform indicator: draw glowing rails to show travel path
    for (const p of world.platforms) {
      if (!p.moving) continue;
      const railC = rgba(100, 255, 200);
      const railS = rgba(40, 160, 120);
      const railH = 0.15;
      // Draw a small beacon cube at origin to mark track center
      const arr = buildCube(p.originX, p.y - p.sy + railH * 2, p.originZ, 0.4, railH, 0.4, railC, railS, cam);
      for (const t of arr) tris.push(t);
    }

    // Platforms — draw collision volumes first for non-GLB platforms, then island geometry.
    for (const p of world.platforms) {
      const hasBlocks = p.blocks && p.blocks.length > 0;
      const hasGLB = !!p.glbModel;

      if (hasGLB) {
        // Collision-only deco platforms carry no meshData — visuals for them
        // are drawn from _ambientDecoPlacements. Skip to avoid double-render/crash.
        if (p.collisionOnly) continue;
        const ddx = p.x - cam.x, ddz = p.z - cam.z;
        const cullDist = p.isPortalIsland ? 999 : 220;
        if (ddx * ddx + ddz * ddz > cullDist * cullDist) continue;

        let modelScale = (typeof p.glbModel.scale === 'number' && isFinite(p.glbModel.scale)) ? p.glbModel.scale : 1.0;
        if (typeof p.glbModel.scale !== 'number' || !isFinite(p.glbModel.scale)) {
          console.warn('[scale] missing/invalid glbModel.scale for platform', p.glbName || p.id || p.name || null, ' — defaulting to 1.0');
          modelScale = 1.0;
        }
        const effectiveScale = modelScale * (p.glbScaleMul ?? 1.0);
        const wx = p.glbWorldX ?? p.x;
        const wy = p.glbWorldY ?? (p.y - p.sy);
        const wz = p.glbWorldZ ?? p.z;
        const platformPalette = this._getPlatformPalette(p);
        const biomeTextures = this._getBiomeTextureTable(platformPalette.biome);
        const islandPalette = {
          ...platformPalette,
          textureTop: biomeTextures?.top || null,
          textureSide: biomeTextures?.side || null,
          textureUnder: biomeTextures?.under || null,
          textureScale: 0.08,
        };
        const cachedIsland = this._islandCache.get(p);
        let islandTris;
        if (cachedIsland && !islandPalette.textureTop) {
          islandTris = buildMeshTrisFromCache(cachedIsland, wx, wy, wz, cam);
        } else {
          islandTris = buildMeshTris(
            p.glbModel.meshData,
            wx, wy, wz,
            islandPalette.top ?? 0xffffffff,
            cam,
            projectVertex,
            effectiveScale,
            0,
            "island",
            islandPalette
          );
        }
        for (const t of islandTris) tris.push(t);
      } else if (p.type === "bridge" && hasBlocks) {
        for (const b of p.blocks) {
          if (b._e0x !== undefined && this._bridgeTexture) {
            // Connected flatsprite: quad spans the plank's shared edge points
            // (computed in buildBridge — interior edges are the exact same
            // spline sample on neighboring planks), so consecutive faces meet
            // and the bridge reads as one continuous spline ribbon. Per-edge
            // perpendiculars (_p0x.. — also shared) keep the side rails
            // seamless through the spline's lateral bow.
            const arr = buildFlatSpriteSpan(
              b._e0x, b._e0y, b._e0z,
              b._e1x, b._e1y, b._e1z,
              b._plankW,
              rgba(255, 255, 255),
              this._bridgeTexture, cam,
              b._p0x, b._p0z, b._p1x, b._p1z,
              b._v0, b._v1
            );
            for (const t of arr) tris.push(t);
          } else if (b._axisNX !== undefined && this._bridgeTexture) {
            // Legacy flatsprite fallback (blocks without edge data): one flat
            // textured plane per plank at the collision top.
            const arr = buildFlatSprite(
              b.wx, b.wy + b.sy, b.wz,
              b._axisNX, b._axisNZ,
              b._plankL, b._plankW,
              rgba(255, 255, 255),
              this._bridgeTexture, cam
            );
            for (const t of arr) tris.push(t);
          } else if (b._axisNX !== undefined) {
            const arr = buildOrientedPlank(
              b.wx, b.wy, b.wz,
              b._axisNX, b._axisNZ,
              b._plankL, b._plankW, b.sy,
              b.top, b.side, cam
            );
            for (const t of arr) tris.push(t);
          }
        }
      } else if (hasBlocks) {
        for (const b of p.blocks) {
          let arr;
          if (b.shape === "trap") {
            arr = buildTrapezoid(b.wx, b.wy, b.wz, b.sx, b.sy, b.sz, b.topScale, b.yaw, b.top, b.side, cam);
          } else if (b.shape === "tri") {
            arr = buildTriPrism(b.wx, b.wy, b.wz, b.r, b.sy, b.yaw, b.top, b.side, cam);
          } else if (b._axisNX !== undefined) {
            arr = buildOrientedPlank(
              b.wx, b.wy, b.wz,
              b._axisNX, b._axisNZ,
              b._plankL, b._plankW, b.sy,
              b.top, b.side, cam
            );
          } else {
            arr = buildCubeWithAdjacency(b, cam, p.blocks);
          }
          for (const t of arr) tris.push(t);

          if (!b.shape && b._axisNX === undefined && b.sy !== undefined && b.sx !== undefined) {
            const botY = b.wy - b.sy;
            const taperArr = buildIslandTaper(b.wx, botY, b.wz, b.sx, b.sz, b.side, cam);
            for (const t of taperArr) tris.push(t);
          }
        }
      } else {
        const arr = buildCube(p.x, p.y - 0.5, p.z, p.sx, 0.5, p.sz, p.color, p.side, cam);
        for (const t of arr) tris.push(t);
        const taperArr = buildIslandTaper(p.x, p.y - 1.0, p.z, p.sx, p.sz, p.side || p.color, cam);
        for (const t of taperArr) tris.push(t);
      }
    }

    // Biome decorations — trees, spires, mushrooms, cacti, gemstones, lanterns
    if (world.decorations) {
      for (const d of world.decorations) {
        // Simple distance cull — decorations beyond FOG_FAR are invisible anyway
        const ddx = d.x - cam.x, ddz = d.z - cam.z;
        if (ddx * ddx + ddz * ddz > 200 * 200) continue;

        let dArr;
        const sc = d.scale;
        switch (d.type) {
          case "tree":     dArr = buildTree(d.x, d.y, d.z, sc, cam); break;
          case "pine":     dArr = buildPine(d.x, d.y, d.z, sc, cam); break;
          case "spire":    dArr = buildSpire(d.x, d.y, d.z, sc, cam); break;
          case "mushroom": dArr = buildMushroom(d.x, d.y, d.z, sc, cam); break;
          case "cactus":   dArr = buildCactus(d.x, d.y, d.z, sc, cam); break;
          case "gemstone": dArr = buildGemstone(d.x, d.y, d.z, sc, d.biome, cam); break;
          case "lantern":  dArr = buildLantern(d.x, d.y, d.z, sc, this.frame, cam); break;
          default:         dArr = [];
        }
        for (const t of dArr) tris.push(t);
      }
    }

    // Ambient deco models — land rings, mountains, buildings
    if (this._ambientDecoPlacements.length > 0) {
      const DECO_CULL = 280 * 280;
      for (const deco of this._ambientDecoPlacements) {
        const ddx = deco.x - cam.x, ddz = deco.z - cam.z;
        if (ddx * ddx + ddz * ddz > DECO_CULL) continue;
        // Build a biome-matched island palette so deco models get the same
        // texture treatment as regular island platforms.
        const decoBiome = deco.biome || this._levelBiome || "grass";
        const decoTexTable = this._getBiomeTextureTable(decoBiome);
        const decoPaletteBase = this._getLevelBiomePalette(decoBiome);
        const decoPalette = {
          ...decoPaletteBase,
          biome: decoBiome,
          textureTop:   decoTexTable?.top   || null,
          textureSide:  decoTexTable?.side  || decoTexTable?.top || null,
          textureUnder: decoTexTable?.under || null,
          textureScale: 0.08,
        };
        const decoTris = buildMeshTris(
          deco.mesh,
          deco.x, deco.y, deco.z,
          decoPalette.top ?? rgba(140, 130, 125),
          cam,
          projectVertex,
          deco.scale,
          deco.yaw,
          "island",
          decoPalette
        );
        for (const t of decoTris) tris.push(t);
      }
    }

    // Crystals (scaled 8×) — bounding radius ~3.0
    for (const c of world.crystals) {
      if (c.broken) continue;
      const cs = c.big ? 2.5 : 1;
      pushBoxCulled(c.x, c.y, c.z, 1.76 * cs, 2.4 * cs, 1.76 * cs, CRYSTAL_C, CRYSTAL_S, 3.2 * cs);
    }

    // Sprinkle gems + 1-UP cherries (Phase 4.1)
    if (world.gems && world.gems.length) {
      for (const g of world.gems) {
        if (g.taken) {
          if (g.takenT > 0) {
            // Expanding 4-cube pickup burst
            const t = g.takenT / 20;
            const spread = (1 - t) * 0.9;
            const burst = g.type === "life" ? rgba(255, 90, 90) : rgba(255, 170, 230);
            const offsets = [[-1,-1],[1,-1],[-1,1],[1,1]];
            for (const [ox, oz] of offsets) {
              pushBox(
                g.x + ox * spread,
                g.y + (1 - t) * 0.6,
                g.z + oz * spread,
                0.10 * t, 0.10 * t, 0.10 * t,
                burst, burst
              );
            }
          }
          continue;
        }
        const bobY = g.y + Math.sin(this.frame * 0.08 + g.phase) * 0.25;
        const yaw  = (this.frame * 3 + g.phase * 60) % 360;
        if (g.type === "life") {
          if (this._cherryMesh) {
            const cherryTris = buildMeshTris(
              this._cherryMesh, g.x, bobY, g.z, rgba(220, 30, 30),
              cam, projectVertex, this._cherryScale * 2.2, yaw, "flatRed"
            );
            for (const t of cherryTris) tris.push(t);
          } else {
            pushBoxCulled(g.x, bobY, g.z, 0.5, 0.5, 0.5, rgba(255, 60, 60), rgba(180, 20, 20), 1.2);
          }
        } else {
          if (this._sprinkleMesh) {
            // "sprinkleGradient": magenta→cyan vertical gradient, self-lit
            const gemTris = buildMeshTris(
              this._sprinkleMesh, g.x, bobY, g.z, rgba(255, 120, 220),
              cam, projectVertex, this._sprinkleScale, yaw, "sprinkleGradient"
            );
            for (const t of gemTris) tris.push(t);
          } else {
            pushBoxCulled(g.x, bobY, g.z, 0.35, 0.35, 0.35, rgba(255, 120, 220), rgba(200, 60, 170), 1.0);
          }
        }
      }
    }

    // Breakable crates
    const CRATE_TOP  = rgba(220, 140, 50);
    const CRATE_SIDE = rgba(160, 90, 30);
    const CRATE_BURST= rgba(255, 200, 80);
    if (world.breakables) {
      for (const b of world.breakables) {
        if (b.broken) {
          if (b.shatterT > 0) {
            const t = b.shatterT / 24;
            const spread = (1 - t) * 0.7;
            const offsets = [[-1,-1],[ 1,-1],[-1, 1],[ 1, 1]];
            for (const [ox, oz] of offsets) {
              pushBox(
                b.x + ox * spread * 0.4,
                b.y + (1 - t) * 0.4,
                b.z + oz * spread * 0.4,
                0.12 * t, 0.12 * t, 0.12 * t,
                CRATE_BURST, CRATE_SIDE
              );
            }
          }
          continue;
        }
        pushBoxCulled(b.x, b.y, b.z, 2.24, 2.24, 2.24, CRATE_TOP, CRATE_SIDE, 4.0);
      }
    }

    // Hazards — spikes, lava pads, crush traps
    if (world.hazards && world.hazards.length) buildHazardTris(world.hazards, this.frame, cam, tris);

    // Player shadow — blob shadow, scales with height above surface
    {
      const sh = this._findShadowY(player, world);
      if (sh !== null) {
        const heightAbove = Math.max(0, player.y - sh);
        // Scale shadow: shrinks and darkens as player goes higher
        const shadowScale = Math.max(0.06, 0.28 - heightAbove * 0.025);
        const shadowAlpha = Math.max(0.3, 1.0 - heightAbove * 0.06);
        const shadowAlpha8 = Math.min(255, (shadowAlpha * 255) | 0);
        const shadowColor = (shadowAlpha8 << 24) | (SHADOW_C & 0x00ffffff);
        pushBox(player.x, sh + 0.01, player.z, shadowScale, 0.005, shadowScale * 0.7, shadowColor, shadowColor);
      }
    }

    // Enemies — regular enemies are player-scale; boss is 2.5× bigger
    const ENEMY_HURT_TOP = rgba(255, 60, 60);
    const ENEMY_HURT_BOT = rgba(255, 140, 140);
    const ENEMY_HP1_TOP  = rgba(180, 80, 40);
    const ENEMY_HP1_BOT  = rgba(220, 120, 60);
    // Boss colors — dark purple/magenta to stand out
    const BOSS_TOP       = rgba(180, 30, 200);
    const BOSS_BOT       = rgba(100, 10, 140);
    const BOSS_FROZEN    = rgba(140, 200, 255);
    const BOSS_HURT_TOP  = rgba(255, 40, 180);
    const BOSS_HURT_BOT  = rgba(255, 120, 220);

    for (const e of world.enemies) {
      if (e.dead) continue;
      const isBoss = !!e.boss;
      // Regular enemies bob at player scale; boss bobs slower/bigger
      const bobAmp = isBoss ? 1.2 : 0.48;
      const bob = (e.frozen ? 0 : Math.sin(e.bobPhase) * bobAmp) + TUN_ENEMIES.heightOffset;

      // Spawn-in FX: converging ice-cube burst while enemy materializes
      if (e.spawnT > 0) {
        const t = e.spawnT / 40; // 1 → 0 as spawn completes
        const SPAWN_C = rgba(160, 220, 255);
        const SPAWN_S = rgba(80, 140, 200);
        const offsets = [[-1,-1],[1,-1],[-1,1],[1,1],[0,-1],[0,1]];
        const spread = t * 2.2; // cubes converge inward
        for (const [ox, oz] of offsets) {
          const s = 0.10 + 0.18 * t;
          pushBox(
            e.x + ox * spread,
            e.y + bob + t * 1.5,
            e.z + oz * spread,
            s, s, s, SPAWN_C, SPAWN_S
          );
        }
      }
      // Shatter FX: expanding ice-shard burst after a frozen enemy breaks
      if (e._shatterFxT > 0) {
        const t = 1 - e._shatterFxT / 20; // 0 → 1 as burst expands
        const SHAT_C = rgba(160, 220, 255);
        const SHAT_S = rgba(80, 140, 200);
        const offsets = [[-1,-1],[1,-1],[-1,1],[1,1],[0,-1],[0,1]];
        const spread = t * 2.4;
        for (const [ox, oz] of offsets) {
          const s = 0.22 * (1 - t) + 0.04;
          pushBox(
            e.x + ox * spread,
            e.y + bob + t * 0.8,
            e.z + oz * spread,
            s, s, s, SHAT_C, SHAT_S
          );
        }
      }

      let pal;
      if (e.frozen) {
        pal = [isBoss ? BOSS_FROZEN : FROZEN_TINT, isBoss ? BOSS_FROZEN : FROZEN_TINT];
      } else if (e._hurtT && e._hurtT > 0) {
        pal = ((e._hurtT / 3) | 0) % 2 === 0
          ? [isBoss ? BOSS_HURT_TOP : ENEMY_HURT_TOP, isBoss ? BOSS_HURT_BOT : ENEMY_HURT_BOT]
          : [isBoss ? BOSS_TOP : ENEMY_TOP, isBoss ? BOSS_BOT : ENEMY_BOT];
      } else if (!isBoss && e.hp === 1) {
        pal = [ENEMY_HP1_TOP, ENEMY_HP1_BOT];
      } else {
        pal = [isBoss ? BOSS_TOP : ENEMY_TOP, isBoss ? BOSS_BOT : ENEMY_BOT];
      }

      if (isBoss) {
        // Boss: sun GLB model at 2.5× scale, or billboard fallback
        if (this._sunMesh && !e.frozen) {
          const bossScale = (this._sunScaleBoss ?? this._sunScale * 2.5) * TUN_ENEMIES.size;
          const sunTris = buildMeshTris(
            this._sunMesh,
            e.x,
            e.y + bob,
            e.z,
            rgba(255, 210, 0),
            cam,
            projectVertex,
            bossScale,
            (e._patrolAngle ? (e._patrolAngle * 180 / Math.PI) : 0) + TUN_ENEMIES.rotation,
            "sunVertex"
          );
          for (const t of sunTris) tris.push(t);
        } else {
          // Billboard fallback (frozen or mesh not yet loaded)
          const bb = buildBillboard(e.x, e.y + bob, e.z, 4.0 * TUN_ENEMIES.size, 5.5 * TUN_ENEMIES.size, pal, cam);
          for (const t of bb) tris.push(t);
        }
        // Boss HP bar — row of pips above head
        if (!e.frozen && e.hp > 0) {
          const maxHp = 6;
          const pipTop  = rgba(255, 200, 0);
          const pipSide = rgba(180, 130, 0);
          const emptyTop  = rgba(60, 50, 20);
          const emptySide = rgba(30, 25, 10);
          // pip height depends on whether sun mesh is loaded (sun is taller)
          const pipY = e.y + bob + (this._sunMesh ? (this._sunScaleBoss ?? 7) * 0.7 + 2 : 7.5);
          const pipSpacing = 1.4;
          for (let pi = 0; pi < maxHp; pi++) {
            const pipX = e.x + (pi - (maxHp - 1) * 0.5) * pipSpacing;
            const alive = pi < e.hp;
            const arr = buildCube(pipX, pipY, e.z, 0.4, 0.4, 0.4,
              alive ? pipTop : emptyTop,
              alive ? pipSide : emptySide, cam);
            for (const t of arr) tris.push(t);
          }
          // Crown above HP bar
          const crownC  = rgba(255, 200, 0);
          const crownS  = rgba(180, 130, 0);
          const crownY  = pipY + 1.2;
          for (let ci = 0; ci < 3; ci++) {
            const crownX = e.x + (ci - 1) * 2.2;
            const crownH = ci === 1 ? 0.8 : 0.5;
            const arr2 = buildCube(crownX, crownY + crownH, e.z, 0.5, crownH, 0.5, crownC, crownS, cam);
            for (const t of arr2) tris.push(t);
          }
        }
      } else {
        // Regular enemy: sun-with-sunglasses GLB mesh if loaded, billboard fallback otherwise
        if (this._sunMesh && !e.frozen) {
          // colorMode "sunVertex": uses GLB vertex colors so sunglasses stay dark
          const sunTris = buildMeshTris(
            this._sunMesh,
            e.x,
            e.y + bob,
            e.z,
            rgba(255, 210, 0),
            cam,
            projectVertex,
            this._sunScale * TUN_ENEMIES.size,
            (e._patrolAngle ? (e._patrolAngle * 180 / Math.PI) : 0) + TUN_ENEMIES.rotation,
            "sunVertex"
          );
          for (const t of sunTris) tris.push(t);
        } else {
          // Billboard fallback (also used when frozen — easy to tint)
          const bb = buildBillboard(e.x, e.y + bob, e.z, 1.4 * TUN_ENEMIES.size, 2.0 * TUN_ENEMIES.size, pal, cam);
          for (const t of bb) tris.push(t);
        }
        // HP pips — only show when damaged
        if (!e.frozen && e.hp > 0 && e.hp <= 2) {
          const pipTop  = e.hp > 1 ? rgba(80, 240, 80) : rgba(255, 120, 40);
          const pipSide = e.hp > 1 ? rgba(20, 140, 20) : rgba(180, 60, 10);
          const pipY = e.y + bob + 2.8;
          const pipSpacing = 0.8;
          for (let pi = 0; pi < e.hp; pi++) {
            const pipX = e.x + (pi - (e.hp - 1) * 0.5) * pipSpacing;
            const arr = buildCube(pipX, pipY, e.z, 0.22, 0.22, 0.22, pipTop, pipSide, cam);
            for (const t of arr) tris.push(t);
          }
        }
      }
    }

    // Portal — always render (landmark; small enough to cull cheaply)
    if (!world.isHub) {
      const allDead = world.enemies.length === 0 || world.enemies.every(e => e.dead);
      const pm  = TUN_PORTAL.size;
      const pc  = hexToABGR(TUN_PORTAL.color);
      const psd = darkenABGR(pc, 0.5);
      if (allDead) {
        const ph = Math.sin(this.frame * 0.12) * 0.4;
        const pulse = 4.0 + Math.sin(this.frame * 0.18) * 0.4;
        pushBoxCulled(world.portal.x, world.portal.y + ph, world.portal.z, pulse * pm, 5.6 * pm, pulse * pm, pc, psd, 10.0);
      } else {
        const PORTAL_LOCKED   = rgba(80,  70,  90);
        const PORTAL_LOCKED_S = rgba(40,  35,  50);
        pushBoxCulled(world.portal.x, world.portal.y, world.portal.z, 3.2 * pm, 4.8 * pm, 3.2 * pm, PORTAL_LOCKED, PORTAL_LOCKED_S, 8.0);
      }
    } else {
      // Phase 4.3 — hub portals (biome tinted) + 3D letter signs
      const pm = TUN_PORTAL.size;
      const PORTAL_LOCKED   = rgba(80,  70,  90);
      const PORTAL_LOCKED_S = rgba(40,  35,  50);
      const SIGN_GRAY   = rgba(150, 150, 160);
      const SIGN_GRAY_S = rgba(80,  80,  95);
      for (const p of world.hubPortals) {
        const ddx = p.x - cam.x, ddz = p.z - cam.z;
        if (ddx * ddx + ddz * ddz > 220 * 220) continue;
        if (!p.locked) {
          const ph = Math.sin(this.frame * 0.12) * 0.4;
          const pulse = 4.0 + Math.sin(this.frame * 0.18) * 0.4;
          pushBoxCulled(p.x, p.y + ph, p.z, pulse * pm, 5.6 * pm, pulse * pm, p.top, darkenABGR(p.top, 0.5), 10.0);
        } else {
          pushBoxCulled(p.x, p.y, p.z, 3.2 * pm, 4.8 * pm, 3.2 * pm, PORTAL_LOCKED, PORTAL_LOCKED_S, 8.0);
        }
      }
      for (const sign of world.hubSigns) {
        const ddx = sign.x - cam.x, ddz = sign.z - cam.z;
        if (ddx * ddx + ddz * ddz > 220 * 220) continue;
        const top  = sign.locked ? SIGN_GRAY   : sign.top;
        const side = sign.locked ? SIGN_GRAY_S : sign.side;
        // Cache text half-width for post placement
        if (sign._hw === undefined) {
          let hw = 0;
          for (const r of sign.runs) hw = Math.max(hw, Math.abs(r.o) + r.halfLen);
          sign._hw = hw;
        }
        // Two side posts framing the name
        for (const dir of [-1, 1]) {
          const arr = buildCube(
            sign.x + sign.ax * (sign._hw + 0.7) * dir, sign.y + 1.2,
            sign.z + sign.az * (sign._hw + 0.7) * dir,
            0.28, 1.7, 0.28, side, side, cam);
          for (const t of arr) tris.push(t);
        }
        // Letter planks (RLE runs of the bitmap font, extruded)
        for (const run of sign.runs) {
          const arr = buildOrientedPlank(
            sign.x + sign.ax * run.o, sign.y + run.y, sign.z + sign.az * run.o,
            sign.ax, sign.az, run.halfLen, sign.depth, run.halfH,
            top, side, cam);
          for (const t of arr) tris.push(t);
        }
      }
    }

    // Enemy death burst — bigger for boss
    for (const e of world.enemies) {
      if (!e.dead || !e.deathT || e.deathT <= 0) continue;
      const deathFrames = e.boss ? 45 : 30;
      const t = e.deathT / deathFrames;
      const spreadMul = e.boss ? 2.5 : 0.9;
      const spread = (1 - t) * spreadMul;
      const BURST_C = e.boss ? rgba(220, 80, 255) : rgba(160, 220, 255);
      const BURST_S = e.boss ? rgba(140, 20, 200) : rgba(80,  140, 200);
      const offsets = e.boss
        ? [[-1,-1],[1,-1],[-1,1],[1,1],[0,-1],[0,1],[-1,0],[1,0],[0,0]]
        : [[-1,-1],[1,-1],[-1,1],[1,1],[0,-1],[0,1]];
      for (const [ox, oz] of offsets) {
        const s = e.boss ? 0.5 * t : 0.14 * t;
        pushBox(
          e.x + ox * spread * 0.5,
          e.y + (1 - t) * (e.boss ? 2.0 : 0.5),
          e.z + oz * spread * 0.5,
          s, s, s, BURST_C, BURST_S
        );
      }
    }

    // Player — GLB mesh if loaded, billboard fallback otherwise.
    // I-frame flicker: skip rendering every other 4-frame window while invulnerable.
    const playerFlicker = player.invulnT > 0 && ((this.frame >> 2) & 1);
    if (playerFlicker) {
      // skip — hit flicker
    } else if (this._froyoMesh) {
      const sq = player.squash;
      // autoScale normalizes the model to 1.0 unit tall; squash/stretch on top.
      const meshScale = (this._meshAutoScale ?? 1.0) * (1 + sq * 0.25) * TUN_PLAYER.size;
      // buildMeshTris now subtracts the local bounding-box center internally
      // (mesh.localCX/CY/CZ set during load), then adds worldX/Y/Z.
      // So we pass player.y as worldY — the model centres itself on that point.
      // The auto-scale was chosen so the model is 1.0 unit tall, meaning its
      // center sits at player.y and feet are at player.y - 0.5 automatically.
      const worldY = player.y;
      // Animation state machine picks the baked frame (idle/walk/jump/fall/land).
      const fm = this._pickFroyoFrame(player) || this._froyoMesh;
      // Hand-painted texture: render "textured" with a white base (pure texel
      // colors, lit) — HIT flashes the tint red. Untextured GLB falls back to
      // the legacy "froyo" palette mode.
      const hitColor = (player.state & STATE.HIT)
        ? rgba(255, 120, 100)
        : (fm.texture ? rgba(255, 255, 255) : rgba(245, 200, 170));
      const meshTris = buildMeshTris(
        fm,
        player.x,
        worldY,
        player.z,
        hitColor,
        cam,
        projectVertex,
        meshScale,
        player.yaw + TUN_PLAYER.rotation,
        fm.texture ? "textured" : "froyo"
      );
      for (const t of meshTris) tris.push(t);
    } else {
      const palette = (player.state & STATE.HIT)
        ? [rgba(255, 80, 80), rgba(255, 200, 200)]
        : [PLAYER_TOP, PLAYER_BOT];
      const leanRaw = player.yawVel * 0.035;
      const lean = Math.max(-0.11, Math.min(0.11, leanRaw));
      const sq = player.squash;
      const sx = 1 - sq * 0.4;
      const sy = 1 + sq * 0.45;
      const bb = buildBillboard(
        player.x, player.y, player.z,
        0.70 * sx * TUN_PLAYER.size, 1.0 * sy * TUN_PLAYER.size, palette, cam, lean
      );
      for (const t of bb) tris.push(t);
    }

    // Front muzzle pip — red cherry GLB if loaded, red cube fallback otherwise
    {
      const yaw = player.yaw || 0;
      const fx = Math.sin((yaw * Math.PI) / 180);
      const fz = Math.cos((yaw * Math.PI) / 180);
      const muzzleY = this._froyoMesh
        ? player.y + 0.10
        : player.y + 0.20;
      const muzzleDist = this._froyoMesh ? 0.50 : 0.80;
      const mx = player.x + fx * muzzleDist;
      const my = muzzleY;
      const mz = player.z + fz * muzzleDist;
      const hot = this.breath.cooldown > 0;

      if (this._cherryMesh && !hot) {
        // Cherry GLB rendered at muzzle position, facing same direction as player
        // colorMode "flatRed" forces every triangle to solid red regardless of vertex colors
        const cherryTris = buildMeshTris(
          this._cherryMesh,
          mx, my, mz,
          rgba(220, 30, 30),
          cam,
          projectVertex,
          this._cherryScale,
          yaw,
          "flatRed"
        );
        for (const t of cherryTris) tris.push(t);
      } else {
        // Cube fallback, or ice-breath cooling flash
        const top  = hot ? rgba(140, 240, 255) : rgba(255, 40, 40);
        const side = hot ? rgba(60, 160, 220)  : rgba(180, 10, 10);
        const arr = buildCube(mx, my, mz, 0.20, 0.20, 0.20, top, side, cam);
        for (const t of arr) tris.push(t);
      }
    }

    // Enemy projectiles — boss projectiles are large dark purple; regular are red fireballs
    {
      const PROJ_TOP        = rgba(255, 80, 60);
      const PROJ_SIDE       = rgba(180, 40, 20);
      const BOSS_PROJ_TOP   = rgba(200, 30, 255);
      const BOSS_PROJ_SIDE  = rgba(110, 10, 180);
      for (const proj of projectiles) {
        const s = proj.boss ? 2.2 : 1.2;
        const top  = proj.boss ? BOSS_PROJ_TOP  : PROJ_TOP;
        const side = proj.boss ? BOSS_PROJ_SIDE : PROJ_SIDE;
        const arr = buildCube(proj.x, proj.y, proj.z, s, s, s, top, side, cam);
        for (const t of arr) tris.push(t);
      }
    }

    // Draw all geometry
    for (const t of tris) {
      if (t.texture) drawTexturedTri(rd, t.verts[0], t.verts[1], t.verts[2], t.color, t.texture);
      else drawTri(rd, t.verts[0], t.verts[1], t.verts[2], t.color);
    }

    // Particle pass (breath)
    for (const p of this.breath.particles) {
      const t = 1 - p.age / p.life;
      const c = lerp32(PARTICLE_C, 0xff100428, 1 - t); // fade slightly
      drawPixelW(rd, p, cam, c, 0);
    }

    // Wind zone particles — currently hidden while wind obstacles are paused.
    if (false && world.windZones) {
      const WIND_C = rgba(200, 240, 255);
      for (const wz of world.windZones) {
        const ddx = wz.x - cam.x, ddz = wz.z - cam.z;
        if (ddx * ddx + ddz * ddz > 140 * 140) continue;
        // Emit ~8 particles per zone, cycling by frame
        for (let wi = 0; wi < 8; wi++) {
          const phase = (this.frame * 0.04 + wi * 0.785) % (Math.PI * 2);
          const r = wz.radius * (0.3 + (wi % 3) * 0.25);
          const wx = wz.x + Math.cos(phase + wz.angle) * r;
          const wz2 = wz.z + Math.sin(phase + wz.angle) * r;
          const wy = player.y + Math.sin(phase * 2.1 + wi) * 3;
          const fade = ((Math.sin(phase) + 1) * 0.5);
          if (fade < 0.1) continue;
          drawPixelW(rd, { x: wx, y: wy, z: wz2 }, cam, WIND_C, 0);
        }
      }
    }

    // HUD
    const debug = this.debugOpen ? this._buildDebugLines(modes) : null;
    drawHUD(rd, this.hud, debug, this.uiSprites);
  }

  _findShadowY(player, world) {
    let best = null;
    for (const p of world.platforms) {
      const dx = player.x - p.x;
      const dz = player.z - p.z;
      if (Math.abs(dx) <= p.sx && Math.abs(dz) <= p.sz) {
        if (player.y > p.y - 0.1) {
          if (best === null || p.y > best) best = p.y;
        }
      }
    }
    return best;
  }

  // ---- showNotice — display a brief HUD flash message ----------------------
  // Called from main.js via game.showNotice?.() after file import/load actions.
  showNotice(msg) {
    if (msg && this.hud) {
      flashMessage(this.hud, String(msg).slice(0, 28).toUpperCase(), 120);
    }
  }

  // ---- loadFroyoSave — import a .froyo save file ---------------------------
  // Called from main.js when the user picks a .froyo file from the load dialog.
  loadFroyoSave(saveData) {
    if (!saveData || typeof saveData !== "object") return false;
    try {
      // Merge into current save, preserving defaults for any missing keys
      const merged = { ...this.save, ...saveData };
      this.save = merged;
      writeSave(merged);
      // Apply to HUD immediately
      if (typeof merged.sprinkles === "number") notifySprinkles(this.hud, merged.sprinkles);
      if (typeof merged.lives === "number")     notifyLives(this.hud, merged.lives);
      // Apply audio settings
      if (typeof merged.fxVolume === "number")  sfxSetVolume(merged.fxVolume);
      if (typeof merged.bgmVolume === "number") bgmSetVolume(merged.bgmVolume);
      return true;
    } catch (err) {
      console.warn("[game] loadFroyoSave failed:", err);
      return false;
    }
  }

  _buildDebugLines(modes) {
    const inp = this.input;
    const s = this.player.state;
    const flags = [];
    if (s & STATE.WALK) flags.push("WALK");
    if (s & STATE.CHARGE) flags.push("CHARGE");
    if (s & STATE.JUMP) flags.push("JUMP");
    if (s & STATE.DOUBLE_JUMP) flags.push("DBLJMP");
    if (s & STATE.GLIDE) flags.push("GLIDE");
    if (s & STATE.HIT) flags.push("HIT");
    if (s & STATE.FROZEN) flags.push("FROZEN");
    if (s & STATE.DEAD) flags.push("DEAD");
    const moveNames = ["IDLE", "WALK", "CHARGE", "AIR", "GLIDE"];
    const jumpNames = ["GRND", "JUMP", "DBLJMP", "FALL"];
    return [
      `FLAGS:  ${flags.join(" ") || "NONE"}`,
      `TOKENS: ${this.player.jumpTokens}  GLIDE:${this.player._glideArmed ? "ARMED" : "off"}`,
      `MOVE:   ${modes ? moveNames[modes.movementMode] : "-"}`,
      `JUMP:   ${modes ? jumpNames[modes.jumpMode] : "-"}`,
      `POS:    ${this.player.x.toFixed(1)} ${this.player.y.toFixed(1)} ${this.player.z.toFixed(1)}`,
      `VEL:    ${this.player.vx.toFixed(2)} ${this.player.vy.toFixed(2)} ${this.player.vz.toFixed(2)}`,
      `INPUT:  ${inp.axisX.toFixed(1)} ${inp.axisY.toFixed(1)}  ORB:${inp.orbitX.toFixed(1)}  PAD:${inp.isGamepadConnected() ? "YES" : "NO"}`,
      `YAW:    P:${this.player.yaw.toFixed(0)}  CAM:${this.camera.yaw.toFixed(0)}  PIT:${this.camera.pitch.toFixed(0)}`,
      `LEAN:   ${this.player.yawVel.toFixed(1)} DEG/F  SQ:${this.player.squash.toFixed(2)}`,
      `CAM:    FOV:${this.camera.fovMul.toFixed(2)}  LOOK:${this.camera.lookPitch.toFixed(0)}`,
      `LOOKAT: ${this.camera.lookAtX.toFixed(1)} ${this.camera.lookAtY.toFixed(1)} ${this.camera.lookAtZ.toFixed(1)}`,
    ];
  }
}

// ---- Helpers used by FroyoGame above ----------------------------------------

function lerp32(a, b, t) {
  const ar = a & 0xff, ag = (a >>> 8) & 0xff, ab = (a >>> 16) & 0xff;
  const br = b & 0xff, bg = (b >>> 8) & 0xff, bb = (b >>> 16) & 0xff;
  const r = ar + (br - ar) * t;
  const g = ag + (bg - ag) * t;
  const b2 = ab + (bb - ab) * t;
  return (255 << 24) | ((b2 | 0) << 16) | ((g | 0) << 8) | (r | 0);
}

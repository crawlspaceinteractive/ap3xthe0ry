/**
 * racer/racergame.js — Game orchestrator for the PS1 arcade racer.
 *
 * States: INTRO → MENU → RACE ⇄ PAUSE. Leaving a course (QUIT) passes through
 * LOADING — an intro-style loading bar with the last track's sky orbiting
 * behind it — before settling into MENU. Fixed-step 60Hz simulation inside a
 * rAF loop (accumulator), so physics is identical on 60/120/144Hz displays. Rendering happens once per rAF.
 */
import {
  createRenderer, clearSky, present, setFogDistance,
  drawTriangle, drawTexturedTriangle, drawPixelW, drawBillboardSprite,
  buildTexturedFace, project, rgba, drawRect, drawText,
} from "../engine/renderer.js";
import { sinDeg, cosDeg, scaleAtX, HALF_W, SCREEN_W, SCREEN_H, HALF_H } from "../engine/luts.js";
import { InputController, BTN_FLAGS } from "../engine/input.js";
import { loadTexture, loadAnimatedTexture, frameAtTime } from "../engine/textureloader.js";
import { drawSpriteFit } from "../engine/spritesheet.js";
import { assetUrl } from "../engine/asseturls.js";
import { loadGLBMeshIfAvailable } from "../engine/geometry.js";
import { getLevelDef, findLevelIndex, resolveLevelTrack, hydrateLevels, levelCount } from "./levels.js";
import { createVehicle, stepVehicle } from "./vehicle.js";
import { createChaseCam, updateChaseCam, snapChaseCam } from "./chasecam.js";
import { prepareVehicleMesh, buildVehicleTris, getHeadlightRig } from "./vehiclemesh.js";
import { buildTrackTris } from "./trackrender.js";
import { createTireStacks, stepTireStacks, buildTireStackTris } from "./tirestacks.js";
import { drawGlobePlaceholder, drawGlobeCrosshair } from "./trackglobe.js";
import { drawRacerHUD } from "./racerhud.js";
import { TitleIntro } from "./titleintro.js";
import { MenuController } from "./menus.js";
import { drawLoadingBar } from "./loading.js";
import { loadHudFonts, drawBigText, measureBigText } from "./hudfont.js";
import { createLapTimer, stepLapTimer, resetLapTimer, unarmLapTimer } from "./laptimer.js";
import { racerSound } from "./racersound.js";
import { createSkyLayers } from "./sky.js";
import { createScenery } from "./scenery.js";
import { loadAutosave, applySnapshot, captureSnapshot, saveAutosave } from "../data/autosave.js";

/** Authoring hook: ?level=hill-test or ?level=1 (resolved after manifest hydrate).
 *  Returns { idx, fromQuery }. */
function levelIdxFromQuery() {
  try {
    const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("level") : null;
    if (q == null || q === "") return { idx: 0, fromQuery: false };
    if (/^\d+$/.test(q)) return { idx: Math.max(0, parseInt(q, 10) | 0), fromQuery: true };
    const byId = findLevelIndex(q);
    return { idx: byId >= 0 ? byId : 0, fromQuery: byId >= 0 };
  } catch (_) {
    return { idx: 0, fromQuery: false };
  }
}

const STEP_MS = 1000 / 60;
const MAX_FRAME_MS = 100;
// Fixed duration (60Hz frames) of the menu-transition loading screen. The bar
// fills at the same pace as the boot intro's LOAD phase (LOAD_T) so the two
// are visually identical, then drops into MENU.
const LOADING_T = 180;
// Quick globe-backed loading screen on the way INTO a course (menu → RACE) —
// a short beat so the track resolves behind the map-select globe.
const RACE_LOADING_T = 90;
// How long the autosave icon stays on screen after a save call (60Hz frames).
const AUTOSAVE_FLASH_FRAMES = 90;

// Flat backdrop behind the MAIN/GAMEMODES/COURSES/etc. menu screens — the 3D
// orbiting track scene used to render back there; now it's just this.
const MENU_BG = rgba(9, 8, 15);

const SMOKE_COLORS = [rgba(200, 200, 205), rgba(80, 165, 255), rgba(255, 150, 50), rgba(200, 90, 255)];
const BOOST_COLORS = [rgba(255, 200, 80), rgba(255, 120, 40), rgba(255, 240, 180)];
const FLARE_TINT = rgba(255, 250, 235);
const DUST_COLORS = [rgba(150, 130, 95), rgba(118, 98, 68)];  // off-road dirt kick-up

// Head2head player accent colors (HUD + winner banner).
const P1_ACCENT = rgba(120, 240, 200);
const P2_ACCENT = rgba(120, 170, 255);

// Headlight FX anchors are pulled ~HL_INSET screen px toward the screen center
// (perspective-corrected at the light's depth). The nudge moves along the
// CAMERA's screen-right world vector (cos yaw, 0, -sin yaw) — never raw world X,
// whose screen direction flips whenever the car heads -Z/-X (cos yaw < 0), which
// would push the lamps OUTWARD.
const HL_INSET = 8;
const insetAnchor = (S, cam) => {
  const p = project(S, cam);
  if (!p.visible) return S;
  const pxPerUnit = scaleAtX(p.cz) * (cam.fovMul || 1) || 1;
  const dir = p.sx < HALF_W ? 1 : -1;
  // Clamp the world-space shift to 8 screen px AND to the screen center — a
  // lamp closer than 8 px to center stops AT center instead of crossing it.
  const maxPx = dir > 0 ? HALF_W - p.sx : p.sx - HALF_W;
  const k = Math.max(0, Math.min(HL_INSET / pxPerUnit, maxPx / pxPerUnit));
  if (k <= 0) return S;
  const rx = cosDeg(cam.yaw);
  const rz = -sinDeg(cam.yaw);
  return { x: S.x + rx * k * dir, y: S.y, z: S.z + rz * k * dir };
};

export class RacerGame {
  constructor(canvas) {
    this.rd = createRenderer(canvas);
    // Shorten the fog range so the ground plane's far band — the pixels just
    // below its vanishing line (rows 79-84, at 100-480 units ahead) — reaches
    // full fog and is culled to sky instead of showing a flat fog band at the
    // horizon. FOG_FAR sits just past the track's cull distance (165) so the
    // full road length stays visible. Enables the renderer's fog-to-sky mode.
    setFogDistance(20, 170);
    this.input = new InputController();
    this._padSrcP1 = null;         // cached per-frame gamepad slots (see _updatePadSources)
    this._padSrcP2 = -1;
    this.state = "INTRO";           // warning card → title cinematic → load bar
    this.intro = new TitleIntro();
    this.menu = new MenuController();
    this.menu.onPersist = () => {
      saveAutosave(captureSnapshot(racerSound, this));
      this._autosaveFlashT = AUTOSAVE_FLASH_FRAMES;
      this._autosaveAnimStart = this.frame;
    };
    this._assetsReady = false;
    this.frame = 0;
    this.levelIdx = 0;             // finalized after hydrateLevels in _load
    this.track = null;
    // Player slots — [{ input, vehicle, cam, lapTimer, place, color }]. Single
    // player has one entry; HEAD2HEAD has two. `vehicle`/`cam` below stay as
    // aliases to slot 0 for the legacy single-player code paths.
    this.players = null;
    this.vehicle = null;
    this.cam = null;
    this.gameMode = "TIME ATTACK"; // last PLAY-mode picked in the GAMEMODES menu
    this.h2h = null;               // head2head race state: { lapsToWin, over, winner, overT }
    this.tireStacks = null;    // destructible tire-stack barriers (open walls)
    this.tex = { road: null, grass: null };
    this.fx = null;           // FX billboard sprites (flare / lightray / smoke)
    this.mesh = null;          // prepared vehicle mesh
    this.particles = [];
    this.sky = createSkyLayers();
    this.scenery = createScenery();
    this.hudFonts = null;      // sprite numeral fonts (racer/hudfont.js)
    this.autosaveIconAnim = null; // assets/2D/ui/autosave_icon.gif -- all frames + delays (engine/gifdecode.js)
    this._autosaveFlashT = 0;  // frames left to show the autosave icon
    this._autosaveAnimStart = 0; // this.frame value when the flash last started -- gif always replays from its own frame 0
    this._acc = 0;
    this._last = 0;
    this._raf = 0;
    this._running = false;
    this._loaded = false;
    this._titleAngle = 0;
    this._loadingT = 0;
    this._loadGen = 0;         // stale-guard for overlapping async loadLevel
    this._raceStartPending = false;
    this._menuLoadPending = false;
    this._previewIdx = -1;     // last course-select preview loaded
  }

  /** Begin asset loading ONLY (no render loop). The boot cinematic
   *  (racer/intro.js) plays on a DOM overlay while this warms the cache, so
   *  assets are in by the time the cinematic reveals → game.start() won't
   *  flash a loading bar. */
  warmup() {
    if (!this._loaded) {
      this._loaded = true;
      this._load();
    }
  }

  start() {
    this._running = true;
    if (!this._loaded) {
      this._loaded = true;
      this._load();
    }
    const loop = (ts) => {
      if (!this._running) return;
      this._raf = requestAnimationFrame(loop);
      this._tick(ts);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    this.input.destroy();
  }

  async _load() {
    // Scan assets/3D/maps/manifest.json into LEVELS before resolving ?level=
    // or loading the first course.
    await hydrateLevels();

    const snap = loadAutosave();
    applySnapshot(snap, racerSound);

    const q = levelIdxFromQuery();
    const n = Math.max(1, levelCount());
    const savedIdx = Math.max(0, Math.min(n - 1, snap.selectedLevelIdx | 0));
    this.levelIdx = q.fromQuery ? Math.max(0, Math.min(n - 1, q.idx)) : savedIdx;
    this.menu.selectedLevelIdx = this.levelIdx;
    this.menu.courseRow = this.levelIdx;
    this._previewIdx = this.levelIdx;

    const [road, grass, meshData, hudFonts, flare, ray, smoke, autosaveIconAnim] = await Promise.all([
      loadTexture(assetUrl("assets/2D/textures/base/rock.png"), { wrap: true }),
      loadTexture(assetUrl("assets/2D/textures/base/grass.png"), { wrap: true }),
      // applyNodeTransforms: respect rotations the creator bakes into the
      // GLB's scene nodes (buildVehicleTris owns the car-yaw transform).
      loadGLBMeshIfAvailable(assetUrl("assets/3D/models/ahura.glb"), "vehicle", false, { applyNodeTransforms: true }),
      loadHudFonts(),
      loadTexture(assetUrl("assets/2D/sprites/fx/headlight_flare.png"), { wrap: false }),
      loadTexture(assetUrl("assets/2D/sprites/fx/lightray.png"), { wrap: false }),
      loadTexture(assetUrl("assets/2D/sprites/fx/smoke_anim.png"), { wrap: false }),
      // All frames + delays, so the HUD toast icon actually plays.
      loadAnimatedTexture(assetUrl("assets/2D/ui/autosave_icon.gif")),
    ]);
    this.tex.road = road;
    this.tex.grass = grass;
    this.mesh = prepareVehicleMesh(meshData);
    this.hudFonts = hudFonts;
    this.fx = { flare, ray, smoke };
    this.autosaveIconAnim = autosaveIconAnim;
    // Scenery texture + sky layers load in parallel (non-blocking); trees
    // for the first level are placed once the pine texture is in.
    await this.scenery.load();
    this.sky.load();
    await this.loadLevel(this.levelIdx);
    // Mark ready only after the first level resolves so INTRO→MENU never
    // renders with a null track (JSON courses are async).
    this._assetsReady = true;
  }

  /** Build the player slots for the current gameMode on the loaded track.
   *  Slot 0 always reuses this.input (owns the keyboard + first pad); a
   *  HEAD2HEAD second slot reads pad 1 and shares the same GamepadManager. */
  _buildPlayers() {
    const multi = this.gameMode === "HEAD2HEAD";
    const players = [];
    // P2 spawns one car-width to the right of the start line so the two cars
    // don't overlap at the grid; P1 takes the left slot.
    const SPAWN_GAP = 1.1;
    const mk = (input, color, lane) => {
      const vehicle = createVehicle(this.track);
      if (lane !== 0) {
        const px = -cosDeg(vehicle.yaw);
        const pz = sinDeg(vehicle.yaw);
        vehicle.x += px * SPAWN_GAP * lane;
        vehicle.z += pz * SPAWN_GAP * lane;
      }
      return { input, vehicle, cam: createChaseCam(vehicle), lapTimer: createLapTimer(), place: 1, color };
    };
    // ---- Gamepad slot assignment -------------------------------------------
    // Sources resolve dynamically EVERY frame: _updatePadSources caches the
    // currently-connected slots and the controllers re-read the cache on each
    // sample, so pads that connect after build time (or that the browser only
    // exposes late — getGamepads can be empty mid-menu) still land on P2. P1 =
    // keyboard + pad, P2 = pad. With 2+ pads each player pins a distinct slot
    // (enumerated by index, not assumed 0/1); with exactly 1 pad P1 is
    // keyboard-only and P2 takes the pad; with none, P2 is idle.
    this.input.setPadSource(() => this._padSrcP1);
    players.push(mk(this.input, 0, -1));
    if (multi) {
      players.push(mk(new InputController({ padIndex: () => this._padSrcP2, keyboard: false, gp: this.input.gp }), 1, 1));
    }
    // Stable per-band view objects: sky.blit keys its yaw-scroll state off the
    // view object identity, so it must NOT be recreated every frame.
    players.forEach((p, i) => {
      p.view = multi ? { y0: i === 0 ? 0 : HALF_H, h: HALF_H } : null;
    });
    return players;
  }

  /** Recompute the per-player gamepad slots from the pads currently exposed by
   *  the browser, cached so both controllers resolve without re-querying.
   *  Called once per display frame; see _buildPlayers for the policy. Single
   *  player: P1 takes the first connected pad (no reliance on connect events —
   *  a pad detected mid-run is picked up the next frame). Multi: see below. */
  _updatePadSources() {
    const slots = [];
    const all = this.input.gp.safeGetGamepads();
    for (let i = 0; i < all.length; i++) if (all[i]) slots.push(i);
    const multi = !!(this.players && this.players.length > 1);
    let p1, p2 = -1;
    if (multi) {
      if (slots.length >= 2) { p1 = slots[0]; p2 = slots[1]; }
      else if (slots.length === 1) { p1 = -1; p2 = slots[0]; }
      else { p1 = -1; p2 = -1; }
    } else {
      p1 = slots.length >= 1 ? slots[0] : -1;
    }
    this._padSrcP1 = p1;
    this._padSrcP2 = p2;
  }

  /** Build a level's runtime state (track, players/vehicles, chase cams, scenery).
   *  Resolves only through the levels.js list. Safe to call repeatedly —
   *  unloads + swaps. Stale async resolves are ignored via _loadGen.
   *  opts.preview: skip audio duck/fade (used by the COURSES preloader in
   *  _tick — see the "Live course-select preload" comment below). */
  async loadLevel(idx, opts) {
    const preview = !!(opts && opts.preview);
    const gen = ++this._loadGen;
    this.unloadLevel({ quiet: preview });
    this.levelIdx = idx;
    const track = await resolveLevelTrack(getLevelDef(idx));
    if (gen !== this._loadGen) return this;
    this.track = track;
    this.players = this._buildPlayers();
    this.vehicle = this.players[0].vehicle;
    this.cam = this.players[0].cam;
    this.tireStacks = createTireStacks(this.track);
    if (this._assetsReady) this.scenery.place(this.track);
    for (const p of this.players) {
      snapChaseCam(p.cam, p.vehicle);
      resetLapTimer(p.lapTimer);
      p.place = 1;
    }
    this.h2h = this.gameMode === "HEAD2HEAD"
      ? { lapsToWin: 3, over: false, winner: -1, overT: 0, winnerMs: 0 }
      : null;
    this._previewIdx = idx;
    return this;
  }

  /** PLAY path: await list resolve, then enter RACE. */
  async _beginRace() {
    if (this._raceStartPending) return;
    this._raceStartPending = true;
    try {
      await this.loadLevel(this.levelIdx);
      if (!this._running) return;
      this.state = "RACE";
      racerSound.startRace((this.players || []).length > 1);
    } catch (err) {
      console.error("[racer] race start failed", err);
      if (this._running) {
        this.state = "MENU";
        this.menu.reset();
        racerSound.playMenuMusic();
      }
    } finally {
      this._raceStartPending = false;
    }
  }

  /** Tear down the current level's transient state so a fresh load (or a
   *  return to the menu) starts clean. Keeps shared assets (textures, vehicle
   *  mesh, sounds, sky) in memory — they're engine-level, not level-level.
   *  opts.quiet skips audio duck (used while scrubbing COURSES). */
  unloadLevel(opts) {
    this.particles.length = 0;
    this.tireStacks = null;
    // P2 owns its own InputController (keyboard off, shared GamepadManager);
    // destroy it so its listeners don't outlive the level. P1's this.input
    // lives for the whole game session.
    if (this.players) {
      for (let i = 1; i < this.players.length; i++) this.players[i].input.destroy();
    }
    this.players = null;
    this.h2h = null;
    if (!(opts && opts.quiet)) {
      racerSound.duck();
      racerSound.fadeOutMusic(900);
    }
  }

  // ---- Controls mapping --------------------------------------------------------
  _readControls(inp) {
    const throttle = inp.axisY < -0.25 || inp.isDown(BTN_FLAGS.A);
    const brake = inp.axisY > 0.35 || inp.isDown(BTN_FLAGS.B);
    return {
      throttle,
      brake,
      steer: Math.max(-1, Math.min(1, inp.axisX)),
      handbrake: inp.isDown(BTN_FLAGS.LT) || inp.isDown(BTN_FLAGS.RT) || inp.isDown(BTN_FLAGS.X),
      pitchIn: inp.axisY,      // in-air flips: W = backflip, S = frontflip
      reset: inp.justPressed(BTN_FLAGS.SEL) || inp.keyJustPressed("KeyT"),
    };
  }

  _rearHeld(inp) {
    return inp.isDown(BTN_FLAGS.Y) || inp.isKeyDown("KeyR");
  }

  // ---- Frame tick -----------------------------------------------------------------
  _tick(ts) {
    if (!this._last) this._last = ts;
    let dt = ts - this._last;
    this._last = ts;
    if (dt > MAX_FRAME_MS) dt = MAX_FRAME_MS;

    this._updatePadSources();
    this.input.sample();
    if (this.players) {
      for (let i = 1; i < this.players.length; i++) this.players[i].input.sample();
    }
    if (this._autosaveFlashT > 0) this._autosaveFlashT--;

    // ---- State transitions (per display frame) ---------------------------------
    const startPressed = this.input.justPressed(BTN_FLAGS.START);
    const aPressed = this.input.justPressed(BTN_FLAGS.A);
    if (this.state === "INTRO") {
      if (startPressed || aPressed) {
        if (this.intro.pressStart() === "start") racerSound.rev();
      }
      if (this.intro.finished) {
        this.state = "MENU";
        this.menu.reset();
        racerSound.playMenuMusic();
      }
    } else if (this.state === "MENU") {
      const play = this.menu.tick(this.input) === "PLAY";
      // Live course-select preload: as the player scrubs through LEVELS in
      // COURSES, quietly resolve+cache each highlighted track ahead of time
      // (no visible backdrop anymore — see trackglobe.js) so pressing PLAY
      // hits an already-resolved track instead of a cold load.
      if (this.menu.mode === "COURSES" &&
          this.menu.courseRow !== this._previewIdx &&
          !this._raceStartPending) {
        const idx = this.menu.courseRow;
        this._previewIdx = idx;
        this.loadLevel(idx, { preview: true }).catch((err) => {
          console.error("[racer] course preview failed", err);
        });
      }
      if (play) {
        const idx = this.menu.selectedLevelIdx | 0;
        this.levelIdx = idx;
        this.gameMode = this.menu.gameMode || "TIME ATTACK";
        // Course selected: fade the menu theme out, then run the quick
        // globe-backed loading screen before dropping into RACE.
        racerSound.fadeOutMusic(450);
        this._loadingT = 0;
        this._loadingTo = "RACE";
        this.state = "LOADING";
      }
    } else if (this.state === "RACE") {
      const h = this.h2h;
      if (h && h.over) {
        // Head2head finished: show the winner banner until it times out or the
        // player skips back to the menu.
        h.overT++;
        if (startPressed || this.input.keyJustPressed("Escape") || h.overT > 360) {
          this.unloadLevel();
          this._loadingT = 0;
          this._menuLoadPending = false;
          this._loadingTo = "MENU";
          this.state = "LOADING";
        }
      } else if (startPressed || this.input.keyJustPressed("Escape")) {
        this.state = "PAUSE";
        this.menu.enterPause(this.input);
        racerSound.duck();
      }
    } else if (this.state === "PAUSE") {
      const r = this.menu.tick(this.input);
      if (r === "RESUME") {
        this.state = "RACE";
      } else if (r === "QUIT") {
        // Quit to main menu: a loading screen matching the boot intro's LOAD
        // bar, with the last track's sky orbiting behind it. Teardown of the
        // old level + a fresh preload of the selected level happens after the
        // bar fills (see the LOADING branch in the step loop).
        this.unloadLevel();
        this._loadingT = 0;
        this._menuLoadPending = false;
        this._loadingTo = "MENU";
        this.state = "LOADING";
      }
    }

    // ---- Fixed-step simulation ----------------------------------------------------
    this._acc += dt;
    while (this._acc >= STEP_MS) {
      this._acc -= STEP_MS;
      this.frame++;
      if (this.state === "RACE") this._step();
      else if (this.state === "INTRO") this.intro.step(this._assetsReady);
      else if (this.state === "MENU") this._titleAngle += 0.15;
      else if (this.state === "LOADING") {
        this._loadingT++;
        this._titleAngle += 0.15;
        if (this._loadingTo === "RACE") {
          // Entering a course: once the quick bar fills, resolve the level and
          // drop into RACE (startRace hands the music back to the shuffle).
          if (this._loadingT >= RACE_LOADING_T && !this._raceStartPending) {
            this._beginRace();
          }
        } else if (this._loadingT >= LOADING_T && !this._menuLoadPending) {
          // Bar is full — preload the selected level (track/vehicle/cam) so
          // it's ready to go, then settle into MENU once that resolves.
          this._menuLoadPending = true;
          this.loadLevel(this.levelIdx).then(() => {
            this._menuLoadPending = false;
            if (!this._running) return;
            this.menu.selectedLevelIdx = this.levelIdx;
            this.state = "MENU";
            this.menu.reset();
            racerSound.playMenuMusic();
          }).catch((err) => {
            this._menuLoadPending = false;
            console.error("[racer] menu level reload failed", err);
            this.menu.selectedLevelIdx = this.levelIdx;
            this.state = "MENU";
            this.menu.reset();
            racerSound.playMenuMusic();
          });
        }
      }
    }

    this._render();
  }

  _step() {
    const players = this.players || [];
    const multi = players.length > 1;
    for (const p of players) {
      const v = p.vehicle;
      const wasRespawning = v.respawnT > 0;
      const controls = this._readControls(p.input);
      stepVehicle(v, controls, this.track);
      stepTireStacks(this.tireStacks, v);
      v.odometer += Math.abs(v.speedF);
      racerSound.update(v, controls, p === players[0] ? 0 : 1);
      if (wasRespawning && v.respawnT === 0) {
        snapChaseCam(p.cam, v);
        unarmLapTimer(p.lapTimer);
      }
      stepLapTimer(p.lapTimer, this.track, v.x, v.z, v.trackIdx, STEP_MS);
      updateChaseCam(p.cam, v, this.track, this._rearHeld(p.input));
      this._spawnParticles(v);
    }
    if (multi) {
      this._resolveCarCollisions(players);
      // Rank by true race progress: completed laps, then arc distance covered
      // along the spline THIS lap (lapTimer.dist). The old tiebreaker compared
      // curMs (elapsed wall-clock time in the current lap) — that value ticks
      // up identically for every car every frame, so it never actually broke
      // ties and `place` sat frozen at spawn order (P1 always "1st", P2 always
      // "2nd" — i.e. the player NUMBER, not the real position).
      const totalLen = this.track.totalLen || 0;
      const progress = (p) => p.lapTimer.lap * totalLen + p.lapTimer.dist;
      const sorted = [...players].sort((a, b) => progress(b) - progress(a));
      sorted.forEach((p, i) => { p.place = i + 1; });
      this._stepH2H();
    }
    this._updateParticles();
  }

  // ---- Car-vs-car collision (HEAD2HEAD) ----------------------------------------
  // Circle-circle push-apart + a soft velocity bounce along the contact
  // normal, in the same spirit as the wall-collision feel in vehicle.js
  // (TUNE.wallBounce/wallSpeedLoss) but resolved between two live cars
  // instead of against the static spline border. Runs once per pair, after
  // every car has already taken its physics step for the frame.
  _resolveCarCollisions(players) {
    const R = 0.85;           // combined contact radius (~ car width)
    const BOUNCE = 0.6;        // fraction of the closing speed reflected back
    const SPEED_LOSS = 0.3;    // fraction of each car's speed bled off on hit
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i].vehicle, b = players[j].vehicle;
        if (a.respawnT > 0 || b.respawnT > 0) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= 0.0001 || dist >= R) continue;
        const nx = dx / dist, nz = dz / dist;
        // Push both cars apart along the contact normal so they never overlap.
        const overlap = R - dist;
        a.x -= nx * overlap * 0.5;
        a.z -= nz * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.z += nz * overlap * 0.5;
        // Only resolve an actually-approaching hit (separating cars pass through).
        const rvx = b.vx - a.vx, rvz = b.vz - a.vz;
        const vn = rvx * nx + rvz * nz;
        if (vn < 0) {
          const impulse = -(1 + BOUNCE) * vn * 0.5;
          a.vx -= impulse * nx; a.vz -= impulse * nz;
          b.vx += impulse * nx; b.vz += impulse * nz;
          a.vx *= 1 - SPEED_LOSS; a.vz *= 1 - SPEED_LOSS;
          b.vx *= 1 - SPEED_LOSS; b.vz *= 1 - SPEED_LOSS;
          // Reuse the wall-hit timer/FX hook so a car-car hit gets the same
          // crash SFX (racerSound.update edge-detects off wallHitT) and the
          // same brief camera/impact tell as a wall scrape.
          a.wallHitT = 10; b.wallHitT = 10;
        }
      }
    }
  }

  _stepH2H() {
    const h = this.h2h;
    if (!h || h.over) return;
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].lapTimer.lap > h.lapsToWin) {
        h.over = true;
        h.winner = i;
        h.overT = 0;
        h.winnerMs = this.players[i].lapTimer.bestMs;
        racerSound.menuConfirm();
        break;
      }
    }
  }

  // ---- Particles ---------------------------------------------------------------
  _spawnParticles(v) {
    const fx = sinDeg(v.yaw), fz = cosDeg(v.yaw);
    const px = -fz, pz = fx;
    const smoke = this.fx ? this.fx.smoke : null;
    // Drift smoke off the rear wheels (colored by charge tier) — animated sprite
    if (v.drifting && v.grounded && this.frame % 3 === 0) {
      const col = SMOKE_COLORS[v.tier + 1] || SMOKE_COLORS[0];
      for (const side of [-1, 1]) {
        const life = 24 + (Math.random() * 10) | 0;
        this.particles.push({
          x: v.x - fx * 1.1 + px * side * 0.65,
          y: v.y + 0.15,
          z: v.z - fz * 1.1 + pz * side * 0.65,
          vx: -v.vx * 0.15 + (Math.random() - 0.5) * 0.06,
          vy: 0.015 + Math.random() * 0.02,
          vz: -v.vz * 0.15 + (Math.random() - 0.5) * 0.06,
          life, maxLife: life,
          color: col, size: 1,
          sprite: smoke,
        });
      }
    }
    // Boost flames (additive glow)
    if (v.boostT > 0) {
      const life = 8 + (Math.random() * 6) | 0;
      this.particles.push({
        x: v.x - fx * 1.35 + (Math.random() - 0.5) * 0.4,
        y: v.y + 0.35,
        z: v.z - fz * 1.35 + (Math.random() - 0.5) * 0.4,
        vx: -fx * 0.25, vy: 0.01, vz: -fz * 0.25,
        life, maxLife: life,
        color: BOOST_COLORS[(Math.random() * 3) | 0], size: 1,
        sprite: smoke, additive: true,
      });
    }
    // Landing dust puff
    if (v.landT === 9) {
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2;
        this.particles.push({
          x: v.x, y: v.y + 0.1, z: v.z,
          vx: Math.cos(a) * 0.12, vy: 0.03, vz: Math.sin(a) * 0.12,
          life: 14, maxLife: 14, color: rgba(190, 180, 165), size: 1,
          sprite: smoke,
        });
      }
    }
    // Off-road dirt kick-up behind the rear wheels (muddy, small)
    if (v.offroad && v.grounded && this.frame % 2 === 0) {
      const life = 16 + (Math.random() * 8) | 0;
      for (const side of [-1, 1]) {
        this.particles.push({
          x: v.x - fx * 0.9 + px * side * 0.6,
          y: v.y + 0.1,
          z: v.z - fz * 0.9 + pz * side * 0.6,
          vx: -v.vx * 0.12 + (Math.random() - 0.5) * 0.05,
          vy: 0.02 + Math.random() * 0.03,
          vz: -v.vz * 0.12 + (Math.random() - 0.5) * 0.05,
          life, maxLife: life,
          color: DUST_COLORS[(Math.random() * 2) | 0], size: 1,
          sprite: smoke,
        });
      }
    }
    if (this.particles.length > 220) this.particles.splice(0, this.particles.length - 220);
  }

  _updateParticles() {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.x += p.vx; p.y += p.vy; p.z += p.vz;
      p.vy -= 0.001;
      if (--p.life <= 0) ps.splice(i, 1);
    }
  }

  // ---- World FX (headlight glares + ray billboards) --------------------------
  // Headlight beams modeled on the deepsmoke headlights module: each lamp is
  // drawn three ways so the beam reads from every angle —
  //   1. a HORIZONTAL textured quad laid flat at headlight height (top/bottom views)
  //   2. a VERTICAL textured quad rotated 90° around the beam axis (side views)
  //   3. a camera-facing lens-flare sprite at the lamp mouth (front views)
  // All additive, so the sprite's black background "eats itself" — only the
  // streak (bright core at the sprite TOP / lamp end, soft falloff beyond) adds
  // light over the road. Size scales with the tuned model scale (rig.scale).
  _drawHeadlightRays(v, cam) {
    const ray = this.fx && this.fx.ray;
    if (!ray || !v.grounded || !this.mesh) return;
    const rig = getHeadlightRig(this.mesh, v.x, v.y, v.z, v.yaw, v.pitch, v.roll);
    if (!rig) return;
    const len = 5 * rig.scale;      // beam reach ahead of the lamp
    const hw = 0.65 * rig.scale;    // half width of the beam spread
    const fx = rig.fwd.x, fz = rig.fwd.z;
    const px = -fz, pz = fx;        // world-space perpendicular (unit)
    const c = rgba(255, 255, 255);
    for (const key of ["left", "right"]) {
      const S = insetAnchor(rig[key], cam);
      // v runs along the beam (0 = lamp / bright core, 1 = far / transparent
      // tail); u runs across the beam width.
      const quads = [
        [
          { x: S.x + px * hw, y: S.y, z: S.z + pz * hw, u: 0, v: 0 },
          { x: S.x - px * hw, y: S.y, z: S.z - pz * hw, u: 1, v: 0 },
          { x: S.x - px * hw + fx * len, y: S.y, z: S.z - pz * hw + fz * len, u: 1, v: 1 },
          { x: S.x + px * hw + fx * len, y: S.y, z: S.z + pz * hw + fz * len, u: 0, v: 1 },
        ],
        [
          { x: S.x, y: S.y + hw, z: S.z, u: 0, v: 0 },
          { x: S.x, y: S.y - hw, z: S.z, u: 1, v: 0 },
          { x: S.x + fx * len, y: S.y - hw, z: S.z + fz * len, u: 1, v: 1 },
          { x: S.x + fx * len, y: S.y + hw, z: S.z + fz * len, u: 0, v: 1 },
        ],
      ];
      for (const q of quads) {
        for (const t of buildTexturedFace(q, c, ray, cam)) {
          drawTexturedTriangle(this.rd, t.verts[0], t.verts[1], t.verts[2], t.color, t.texture, {
            additive: true,
            depthBias: -0.35,
            noDepthWrite: true,
          });
        }
      }
    }
  }

  // Twin headlight glare billboards glued to the model's front corners
  // (additive glow); size scales with the model's tuned scale factor.
  _drawHeadlightGlare(v, cam) {
    const flare = this.fx && this.fx.flare;
    if (!flare || v.respawnT > 0 || !this.mesh) return;
    const rig = getHeadlightRig(this.mesh, v.x, v.y, v.z, v.yaw, v.pitch, v.roll);
    if (!rig) return;
    const size = 0.95 * rig.scale;
    for (const key of ["left", "right"]) {
      drawBillboardSprite(this.rd, flare, insetAnchor(rig[key], cam), cam, {
        worldSize: size,
        tint: FLARE_TINT,
        additive: true,
        depthBias: -0.4,
      });
    }
  }

  // ---- Render --------------------------------------------------------------------
  _render() {
    const rd = this.rd;

    // Intro cinematic is pure 2D — no 3D scene behind it.
    if (this.state === "INTRO") {
      this.intro.render(rd, this.hudFonts, this.frame, this._assetsReady);
      present(rd, 0, this.intro.fade);
      return;
    }

    // Menu loading screen (leaving a course): the just-left track's sky orbits
    // behind the intro-style loading bar. Rendered here with no 3D geometry —
    // the bar fill mirrors the boot intro's LOAD phase.
    if (this.state === "LOADING") {
      // Entering a course from the menu: the map-select globe is the loading
      // background (same look as COURSES), with the quick loading bar on top.
      if (this._loadingTo === "RACE") {
        drawRect(rd, 0, 0, SCREEN_W, SCREEN_H, MENU_BG, true);
        drawGlobePlaceholder(rd, 0, 0, SCREEN_W, SCREEN_H);
        drawGlobeCrosshair(rd, 0, 0, SCREEN_W, SCREEN_H, this.frame);
        drawLoadingBar(rd, this.hudFonts, Math.min(1, this._loadingT / RACE_LOADING_T));
        this._drawAutosaveIcon(rd);
        present(rd, 0, 0);
        return;
      }
      let a = this._titleAngle;
      let cam2 = this.cam;
      if (this.vehicle) {
        const ori = this.vehicle;
        cam2 = {
          x: ori.x + sinDeg(a) * 16,
          y: ori.y + 6,
          z: ori.z + cosDeg(a) * 16,
          yaw: a + 180,
          pitch: 16,
          fovMul: 1,
        };
      }
      const yaw = cam2 ? cam2.yaw : a + 180;
      const pitch = cam2 ? cam2.pitch : 16;
      clearSky(rd, yaw, this.frame);
      this.sky.blit(rd, yaw, pitch);
      drawLoadingBar(rd, this.hudFonts, Math.min(1, this._loadingT / LOADING_T));
      this._drawAutosaveIcon(rd);
      present(rd, 0, 0);
      return;
    }

    // Main menu no longer renders the 3D orbiting track scene. Flat dark
    // backdrop everywhere, except COURSES, which gets the placeholder globe
    // as its full-screen background — the course list/name/description
    // widgets (menus.js _drawCourses) render as an overlay on top of it.
    // The globe itself is static (no frame passed in) — the wireframe track
    // hologram drawn on top of it in the COURSES panel is what spins.
    if (this.state === "MENU") {
      drawRect(rd, 0, 0, SCREEN_W, SCREEN_H, MENU_BG, true);
      if (this.menu.mode === "COURSES") {
        drawGlobePlaceholder(rd, 0, 0, SCREEN_W, SCREEN_H);
        drawGlobeCrosshair(rd, 0, 0, SCREEN_W, SCREEN_H, this.frame);
      }
      this.menu.draw(rd, this.hudFonts, this.frame);
      this._drawAutosaveIcon(rd);
      present(rd, 0, 0);
      return;
    }

    // RACE / PAUSE use the chase cam and need a live track + vehicle.
    const players = this.players;
    if (!this.track || !players || players.length === 0) {
      clearSky(rd, this._titleAngle + 180, this.frame);
      this.sky.blit(rd, this._titleAngle + 180, 16);
      present(rd, 0, 0);
      return;
    }

    if (players.length === 1) {
      // ---- Single player: one full-screen pass ---------------------------------
      const p = players[0];
      rd.viewY0 = 0;
      rd.viewY1 = SCREEN_H - 1;
      p.cam.sliceY0 = 0;
      p.cam.sliceVScale = 1;
      this._renderScene(p, 0, SCREEN_H, players);
      drawRacerHUD(rd, p.vehicle, this.frame, this.hudFonts, p.place, this.track, p.lapTimer);
      if (this.state === "PAUSE") this.menu.draw(rd, this.hudFonts, this.frame);
      this._drawAutosaveIcon(rd);
      const fade = this._respawnFade(p.vehicle);
      present(rd, 0, fade, fade);
      return;
    }

    // ---- Head2head: two vertical bands (P1 top, P2 bottom) ----------------------
    const top = players[0], bot = players[1];

    rd.viewY0 = 0;
    rd.viewY1 = HALF_H - 1;
    top.cam.sliceY0 = 0;
    top.cam.sliceVScale = 2;
    this._renderScene(top, 0, HALF_H, players);
    drawRacerHUD(rd, top.vehicle, this.frame, this.hudFonts, top.place, this.track,
      top.lapTimer, { view: top.view, color: top.color, allPlayers: players });
    const fadeTop = this._respawnFade(top.vehicle);

    rd.viewY0 = HALF_H;
    rd.viewY1 = SCREEN_H - 1;
    bot.cam.sliceY0 = HALF_H;
    bot.cam.sliceVScale = 2;
    this._renderScene(bot, HALF_H, HALF_H, players);
    drawRacerHUD(rd, bot.vehicle, this.frame, this.hudFonts, bot.place, this.track,
      bot.lapTimer, { view: bot.view, color: bot.color, allPlayers: players });
    const fadeBot = this._respawnFade(bot.vehicle);

    // Restore full-viewport defaults (single-player paths above set their own).
    rd.viewY0 = 0;
    rd.viewY1 = SCREEN_H - 1;

    if (this.state === "PAUSE") this.menu.draw(rd, this.hudFonts, this.frame);
    if (this.h2h && this.h2h.over) this._drawH2HResult(rd);
    this._drawAutosaveIcon(rd);

    present(rd, 0, fadeTop, fadeBot);
  }

  _respawnFade(v) {
    return v.respawnT > 0
      ? Math.min(1, Math.sin((v.respawnT / 45) * Math.PI) * 0.9)
      : 0;
  }

  // ---- Autosave icon ----------------------------------------------------------
  // Bottom-right toast: shown for AUTOSAVE_FLASH_FRAMES whenever menu.onPersist
  // fires a real save (course confirm, leaving OPTIONS, pause resume/quit —
  // see the constructor). Clear of the minimap (top-right) and the drift bar
  // (bottom-left-ish, BAR_X starts at 110), so it never collides with other
  // HUD reads.
  _drawAutosaveIcon(rd) {
    const anim = this.autosaveIconAnim;
    if (this._autosaveFlashT <= 0 || !anim || !anim.frames.length) return;
    // Always replay from the gif's own frame 0 when a save toast starts,
    // rather than sampling whatever point a free-running clock lands on.
    const elapsedMs = (this.frame - this._autosaveAnimStart) * STEP_MS;
    const frame = frameAtTime(anim, elapsedMs);
    if (!frame) return;
    const targetH = 18;
    const pad = 6;
    const scale = targetH / frame.height;
    const targetW = Math.max(1, Math.round(frame.width * scale));
    const x = SCREEN_W - pad - targetW;
    const y = SCREEN_H - pad - targetH;
    drawSpriteFit(rd, frame, x, y, targetH);
  }

  /** One full scene pass (sky + track + cars + FX + particles) as seen through
   *  player `p`'s chase cam, restricted to the y-band [y0, y0+h). Passed
   *  allPlayers so every car (own + opponent) renders into every band. */
  _renderScene(p, y0, h, allPlayers) {
    const rd = this.rd;
    const cam = p.cam;
    clearSky(rd, cam.yaw, this.frame, y0, h);
    this.sky.blit(rd, cam.yaw, cam.pitch, p.view || undefined);

    const tris = buildTrackTris(this.track, this.tex, cam, this.frame);
    this.scenery.build(cam, this.frame, tris);
    buildTireStackTris(this.tireStacks, cam, tris);
    for (const car of allPlayers) {
      const cv = car.vehicle;
      // Hide/blink the car while respawning
      if (this.mesh && (cv.respawnT === 0 || (cv.respawnT & 4))) {
        const carTris = buildVehicleTris(
          this.mesh, cv.x, cv.y, cv.z, cv.yaw, cv.pitch, cv.roll, cam
        );
        for (const t of carTris) tris.push(t);
      }
    }
    tris.sort((a, b) => b.avgZ - a.avgZ);
    for (const t of tris) {
      const fn = t.texture ? drawTexturedTriangle : drawTriangle;
      const v0 = t.verts[0];
      for (let i = 1; i + 1 < t.verts.length; i++) {
        fn(rd, v0, t.verts[i], t.verts[i + 1], t.color, t.texture);
      }
    }
    // Headlight light-ray billboards: camera-facing sprites (alpha blended
    // from the sprite) drawn after the scene + car so the beam is visible
    // from every angle and its bright source at the nose corner isn't hidden
    // by the body. depthBias lets it win over the car's front face.
    for (const car of allPlayers) {
      const cv = car.vehicle;
      if (this.fx && cv.respawnT === 0) {
        this._drawHeadlightRays(cv, cam);
        this._drawHeadlightGlare(cv, cam);
      }
    }
    for (const pa of this.particles) {
      if (pa.sprite) {
        drawBillboardSprite(rd, pa.sprite, pa, cam, {
          worldSize: pa.size * 0.6,
          tint: pa.color,
          additive: !!pa.additive,
          rows: 8,
          frame: pa.maxLife
            ? Math.min(7, (((pa.maxLife - pa.life) * 8) / pa.maxLife) | 0)
            : 0,
          fog: true,
        });
      } else {
        drawPixelW(rd, pa, cam, pa.color, pa.size);
      }
    }
  }

  _drawH2HResult(rd) {
    const h = this.h2h;
    const winner = h.winner === 1 ? "P2 WINS!" : "P1 WINS!";
    const col = h.winner === 1 ? P2_ACCENT : P1_ACCENT;
    const py = 96;
    drawRect(rd, 0, py, SCREEN_W, 48, rgba(10, 8, 18), true);
    drawRect(rd, 0, py, SCREEN_W, 48, rgba(120, 200, 255), false);
    const fonts = this.hudFonts;
    if (fonts && fonts.big) {
      const w = measureBigText(fonts, winner, 30, 2);
      drawBigText(rd, fonts, winner, (SCREEN_W - w) >> 1, py + 9, 30, col, 2);
    } else {
      drawText(rd, winner, (SCREEN_W >> 1) - winner.length * 5, py + 20, col, 2);
    }
    drawRect(rd, 0, py + 48, SCREEN_W, 2, rgba(120, 200, 255), true);
  }
}

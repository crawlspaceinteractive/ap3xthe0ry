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
  buildTexturedFace, project, rgba,
} from "../engine/renderer.js";
import { sinDeg, cosDeg, scaleAtX, HALF_W } from "../engine/luts.js";
import { InputController, BTN_FLAGS } from "../engine/input.js";
import { loadTexture } from "../engine/textureloader.js";
import { assetUrl } from "../engine/asseturls.js";
import { loadGLBMeshIfAvailable } from "../engine/geometry.js";
import { getLevelDef, findLevelIndex, resolveLevelTrack, hydrateLevels } from "./levels.js";
import { createVehicle, stepVehicle } from "./vehicle.js";
import { createChaseCam, updateChaseCam, snapChaseCam } from "./chasecam.js";
import { prepareVehicleMesh, buildVehicleTris, getHeadlightRig } from "./vehiclemesh.js";
import { buildTrackTris } from "./trackrender.js";
import { drawRacerHUD } from "./racerhud.js";
import { TitleIntro } from "./titleintro.js";
import { MenuController } from "./menus.js";
import { drawLoadingBar } from "./loading.js";
import { loadHudFonts } from "./hudfont.js";
import { createLapTimer, stepLapTimer, resetLapTimer } from "./laptimer.js";
import { racerSound } from "./racersound.js";
import { createSkyLayers } from "./sky.js";
import { createScenery } from "./scenery.js";

/** Authoring hook: ?level=hill-test or ?level=1 (resolved after manifest hydrate). */
function levelIdxFromQuery() {
  try {
    const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("level") : null;
    if (q == null || q === "") return 0;
    if (/^\d+$/.test(q)) return Math.max(0, parseInt(q, 10) | 0);
    const byId = findLevelIndex(q);
    return byId >= 0 ? byId : 0;
  } catch (_) {
    return 0;
  }
}

const STEP_MS = 1000 / 60;
const MAX_FRAME_MS = 100;
// Fixed duration (60Hz frames) of the menu-transition loading screen. The bar
// fills at the same pace as the boot intro's LOAD phase (LOAD_T) so the two
// are visually identical, then drops into MENU.
const LOADING_T = 180;

const SMOKE_COLORS = [rgba(200, 200, 205), rgba(80, 165, 255), rgba(255, 150, 50), rgba(200, 90, 255)];
const BOOST_COLORS = [rgba(255, 200, 80), rgba(255, 120, 40), rgba(255, 240, 180)];
const FLARE_TINT = rgba(255, 250, 235);

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
    this.state = "INTRO";           // warning card → title cinematic → load bar
    this.intro = new TitleIntro();
    this.menu = new MenuController();
    this._assetsReady = false;
    this.frame = 0;
    this.levelIdx = 0;             // finalized after hydrateLevels in _load
    this.track = null;
    this.vehicle = null;
    this.cam = null;
    this.tex = { road: null, grass: null };
    this.fx = null;           // FX billboard sprites (flare / lightray / smoke)
    this.mesh = null;          // prepared vehicle mesh
    this.particles = [];
    this.sky = createSkyLayers();
    this.scenery = createScenery();
    this.hudFonts = null;      // sprite numeral fonts (racer/hudfont.js)
    this.place = 1;            // placeholder — position display until a race system exists
    this.lapTimer = createLapTimer();
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
    this.levelIdx = levelIdxFromQuery();
    this.menu.selectedLevelIdx = this.levelIdx;
    this.menu.courseRow = this.levelIdx;
    this._previewIdx = this.levelIdx;

    const [road, grass, meshData, hudFonts, flare, ray, smoke] = await Promise.all([
      loadTexture(assetUrl("assets/2D/textures/base/rock.png"), { wrap: true }),
      loadTexture(assetUrl("assets/2D/textures/base/grass.png"), { wrap: true }),
      // applyNodeTransforms: respect rotations the creator bakes into the
      // GLB's scene nodes (buildVehicleTris owns the car-yaw transform).
      loadGLBMeshIfAvailable(assetUrl("assets/3D/models/ahura.glb"), "vehicle", false, { applyNodeTransforms: true }),
      loadHudFonts(),
      loadTexture(assetUrl("assets/2D/sprites/fx/headlight_flare.png"), { wrap: false }),
      loadTexture(assetUrl("assets/2D/sprites/fx/lightray.png"), { wrap: false }),
      loadTexture(assetUrl("assets/2D/sprites/fx/smoke_anim.png"), { wrap: false }),
    ]);
    this.tex.road = road;
    this.tex.grass = grass;
    this.mesh = prepareVehicleMesh(meshData);
    this.hudFonts = hudFonts;
    this.fx = { flare, ray, smoke };
    // Scenery texture + sky layers load in parallel (non-blocking); trees
    // for the first level are placed once the pine texture is in.
    await this.scenery.load();
    this.sky.load();
    await this.loadLevel(this.levelIdx);
    // Mark ready only after the first level resolves so INTRO→MENU never
    // renders with a null track (JSON courses are async).
    this._assetsReady = true;
  }

  /** Build a level's runtime state (track, vehicle, chase cam, scenery).
   *  Resolves only through the levels.js list. Safe to call repeatedly —
   *  unloads + swaps. Stale async resolves are ignored via _loadGen.
   *  opts.preview: skip audio duck/fade (course-select backdrop swaps). */
  async loadLevel(idx, opts) {
    const preview = !!(opts && opts.preview);
    const gen = ++this._loadGen;
    this.unloadLevel({ quiet: preview });
    this.levelIdx = idx;
    const track = await resolveLevelTrack(getLevelDef(idx));
    if (gen !== this._loadGen) return this;
    this.track = track;
    this.vehicle = createVehicle(this.track);
    this.cam = createChaseCam(this.vehicle);
    if (this._assetsReady) this.scenery.place(this.track);
    snapChaseCam(this.cam, this.vehicle);
    resetLapTimer(this.lapTimer);
    this.place = 1;
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
      racerSound.startRace();
    } catch (err) {
      console.error("[racer] race start failed", err);
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
    resetLapTimer(this.lapTimer);
    this.place = 1;
    if (!(opts && opts.quiet)) {
      racerSound.duck();
      racerSound.fadeOutMusic(900);
    }
  }

  // ---- Controls mapping --------------------------------------------------------
  _readControls() {
    const inp = this.input;
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

  _rearHeld() {
    return this.input.isDown(BTN_FLAGS.Y) || this.input.isKeyDown("KeyR");
  }

  // ---- Frame tick -----------------------------------------------------------------
  _tick(ts) {
    if (!this._last) this._last = ts;
    let dt = ts - this._last;
    this._last = ts;
    if (dt > MAX_FRAME_MS) dt = MAX_FRAME_MS;

    this.input.sample();

    // ---- State transitions (per display frame) ---------------------------------
    const startPressed = this.input.justPressed(BTN_FLAGS.START);
    const aPressed = this.input.justPressed(BTN_FLAGS.A);
    if (this.state === "INTRO") {
      if (startPressed || aPressed) {
        if (this.intro.pressStart() === "start") racerSound.rev();
      }
      if (this.intro.finished) { this.state = "MENU"; this.menu.reset(); }
    } else if (this.state === "MENU") {
      const play = this.menu.tick(this.input) === "PLAY";
      // Live course-select preview: swap the orbiting backdrop to the
      // highlighted LEVELS entry (elevation / ribbon visible behind the UI).
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
        this._beginRace();
      }
    } else if (this.state === "RACE" &&
               (startPressed || this.input.keyJustPressed("Escape"))) {
      this.state = "PAUSE";
      this.menu.enterPause(this.input);
      racerSound.duck();
    } else if (this.state === "PAUSE") {
      const r = this.menu.tick(this.input);
      if (r === "RESUME") {
        this.state = "RACE";
      } else if (r === "QUIT") {
        // Quit to main menu: a loading screen matching the boot intro's LOAD
        // bar, with the last track's sky orbiting behind it. Teardown of the
        // old level + rebuild of the MENU backdrop happens after the bar fills
        // (see the LOADING branch in the step loop).
        this.unloadLevel();
        this._loadingT = 0;
        this._menuLoadPending = false;
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
        if (this._loadingT >= LOADING_T && !this._menuLoadPending) {
          // Bar is full — rebuild the MENU backdrop from the levels list,
          // then settle into MENU once the async resolve finishes.
          this._menuLoadPending = true;
          this.loadLevel(this.levelIdx).then(() => {
            this._menuLoadPending = false;
            if (!this._running) return;
            this.menu.selectedLevelIdx = this.levelIdx;
            this.state = "MENU";
            this.menu.reset();
          }).catch((err) => {
            this._menuLoadPending = false;
            console.error("[racer] menu level reload failed", err);
            this.menu.selectedLevelIdx = this.levelIdx;
            this.state = "MENU";
            this.menu.reset();
          });
        }
      }
    }

    this._render();
  }

  _step() {
    const v = this.vehicle;
    const wasRespawning = v.respawnT > 0;
    const controls = this._readControls();
    stepVehicle(v, controls, this.track);
    v.odometer += Math.abs(v.speedF);
    racerSound.update(v, controls);
    if (wasRespawning && v.respawnT === 0) {
      snapChaseCam(this.cam, v);
      resetLapTimer(this.lapTimer);
    }
    stepLapTimer(this.lapTimer, this.track, v.x, v.z, v.trackIdx, STEP_MS);
    updateChaseCam(this.cam, v, this.track, this._rearHeld());
    this._spawnParticles(v);
    this._updateParticles();
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
    const v = this.vehicle;

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
      present(rd, 0, 0);
      return;
    }

    // Main menu orbits the track center; other states use the chase cam
    let cam = this.cam;
    if (!this.track || !v || !cam) {
      clearSky(rd, this._titleAngle + 180, this.frame);
      this.sky.blit(rd, this._titleAngle + 180, 16);
      present(rd, 0, 0);
      return;
    }
    if (this.state === "MENU") {
      const a = this._titleAngle;
      const v = this.vehicle;
      // COURSES uses an isometric-style orbit (steeper pitch, farther out)
      // so elevation reads clearly — same idea as the spline editor iso view.
      const iso = this.menu.mode === "COURSES";
      const dist = iso ? 28 : 16;
      const height = iso ? 18 : 6;
      const pitch = iso ? 38 : 16;
      cam = {
        x: v.x + sinDeg(a) * dist,
        y: v.y + height,
        z: v.z + cosDeg(a) * dist,
        yaw: a + 180,
        pitch,
        fovMul: iso ? 0.92 : 1,
      };
    }

    clearSky(rd, cam.yaw, this.frame);
    this.sky.blit(rd, cam.yaw, cam.pitch);

    {
      const tris = buildTrackTris(this.track, this.tex, cam, this.frame);
      this.scenery.build(cam, this.frame, tris);
      // Hide/blink the car while respawning
      if (this.mesh && (v.respawnT === 0 || (v.respawnT & 4))) {
        const carTris = buildVehicleTris(
          this.mesh, v.x, v.y, v.z, v.yaw, v.pitch, v.roll, cam
        );
        for (const t of carTris) tris.push(t);
      }
      tris.sort((a, b) => b.avgZ - a.avgZ);
      for (const t of tris) {
        if (t.texture) drawTexturedTriangle(rd, t.verts[0], t.verts[1], t.verts[2], t.color, t.texture);
        else drawTriangle(rd, t.verts[0], t.verts[1], t.verts[2], t.color);
      }
      // Headlight light-ray billboards: camera-facing sprites (alpha blended
      // from the sprite) drawn after the scene + car so the beam is visible
      // from every angle and its bright source at the nose corner isn't hidden
      // by the body. depthBias lets it win over the car's front face.
      if (this.fx && v.respawnT === 0) this._drawHeadlightRays(v, cam);
      for (const p of this.particles) {
        if (p.sprite) {
          drawBillboardSprite(rd, p.sprite, p, cam, {
            worldSize: p.size * 0.6,
            tint: p.color,
            additive: !!p.additive,
            rows: 8,
            frame: p.maxLife
              ? Math.min(7, (((p.maxLife - p.life) * 8) / p.maxLife) | 0)
              : 0,
            fog: true,
          });
        } else {
          drawPixelW(rd, p, cam, p.color, p.size);
        }
      }
      this._drawHeadlightGlare(v, cam);
    }

    // ---- HUD ----------------------------------------------------------------------
    if (this.state === "MENU") this.menu.draw(rd, this.hudFonts, this.frame);
    else {
      drawRacerHUD(rd, v, this.frame, this.hudFonts, this.place, this.track, this.lapTimer);
      if (this.state === "PAUSE") this.menu.draw(rd, this.hudFonts, this.frame);
    }

    // Screen fade during respawn for a clean transition
    const fade = v.respawnT > 0
      ? Math.min(1, Math.sin((v.respawnT / 45) * Math.PI) * 0.9)
      : 0;
    present(rd, 0, fade);
  }
}

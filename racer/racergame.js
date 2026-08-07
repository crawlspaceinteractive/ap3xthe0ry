/**
 * racer/racergame.js — Game orchestrator for the PS1 arcade racer.
 *
 * States: LOADING → TITLE → RACE ⇄ PAUSE.
 * Fixed-step 60Hz simulation inside a rAF loop (accumulator), so physics is
 * identical on 60/120/144Hz displays. Rendering happens once per rAF.
 */
import {
  createRenderer, clearSky, present, setFogDistance,
  drawTriangle, drawTexturedTriangle, drawPixelW, drawBillboardSprite,
  buildTexturedFace, project, rgba,
} from "../engine/renderer.js";
import { sinDeg, cosDeg, scaleAtX, HALF_W } from "../engine/luts.js";
import { InputController, BTN_FLAGS } from "../engine/input.js";
import { loadTexture } from "../engine/textureloader.js";
import { loadGLBMeshIfAvailable } from "../engine/geometry.js";
import { buildTrack } from "./track.js";
import { createVehicle, stepVehicle } from "./vehicle.js";
import { createChaseCam, updateChaseCam, snapChaseCam } from "./chasecam.js";
import { prepareVehicleMesh, buildVehicleTris, getHeadlightRig } from "./vehiclemesh.js";
import { buildTrackTris } from "./trackrender.js";
import { drawRacerHUD, drawTitle, drawPause, drawLoading } from "./racerhud.js";
import { loadHudFonts } from "./hudfont.js";
import { createLapTimer, stepLapTimer, resetLapTimer } from "./laptimer.js";
import { racerSound } from "./racersound.js";
import { createSkyLayers } from "./sky.js";
import { createScenery } from "./scenery.js";

const STEP_MS = 1000 / 60;
const MAX_FRAME_MS = 100;

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
    this.state = "LOADING";
    this.frame = 0;
    this.track = buildTrack();
    this.vehicle = createVehicle(this.track);
    this.cam = createChaseCam(this.vehicle);
    this.fullscreenTarget = (typeof document !== "undefined") ?
      document.getElementById("froyo-shell") || canvas : null;
    this._onRawKeyDown = this._onRawKeyDown.bind(this);
    if (typeof window !== "undefined") window.addEventListener("keydown", this._onRawKeyDown);
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
    this._titleAngle = 0;

    // Pause menu state
    this._pauseRow = 0;
    this._settingsHeld = 0;
    this._prevAxisX = 0;
    this._prevAxisY = 0;
  }

  start() {
    this._running = true;
    this._load();
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
    if (typeof window !== "undefined") window.removeEventListener("keydown", this._onRawKeyDown);
    this.input.destroy();
  }

  _onRawKeyDown(e) {
    if (e.code === "KeyF") {
      this.toggleFullscreen();
    }
  }

  isFullscreen() {
    if (typeof document === "undefined") return false;
    const active = document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
    return active === this.fullscreenTarget;
  }

  toggleFullscreen() {
    if (typeof document === "undefined" || !this.fullscreenTarget) return;
    if (this.isFullscreen()) {
      const exit = document.exitFullscreen || document.mozCancelFullScreen || document.webkitExitFullscreen || document.msExitFullscreen;
      exit?.();
    } else {
      const request = this.fullscreenTarget.requestFullscreen || this.fullscreenTarget.mozRequestFullScreen || this.fullscreenTarget.webkitRequestFullscreen || this.fullscreenTarget.msRequestFullscreen;
      request?.();
    }
  }

  async _load() {
    const [road, grass, meshData, hudFonts, flare, ray, smoke] = await Promise.all([
      loadTexture("assets/2D/textures/rock.png", { wrap: true }),
      loadTexture("assets/2D/textures/grass.png", { wrap: true }),
      // applyNodeTransforms: respect rotations the creator bakes into the
      // GLB's scene nodes (buildVehicleTris owns the car-yaw transform).
      loadGLBMeshIfAvailable("assets/3D/models/ahura.glb", "vehicle", false, { applyNodeTransforms: true }),
      loadHudFonts(),
      loadTexture("assets/2D/sprites/headlight_flare.png", { wrap: false }),
      loadTexture("assets/2D/sprites/lightray.png", { wrap: false }),
      loadTexture("assets/2D/sprites/smoke_anim.png", { wrap: false }),
    ]);
    this.tex.road = road;
    this.tex.grass = grass;
    this.mesh = prepareVehicleMesh(meshData);
    this.hudFonts = hudFonts;
    this.fx = { flare, ray, smoke };
    // Load sky layers and scenery in parallel (non-blocking)
    this.sky.load();
    this.scenery.load(this.track);
    if (this.state === "LOADING") this.state = "TITLE";
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
    if (this.state === "TITLE" && (startPressed || aPressed)) {
      this.state = "RACE";
      snapChaseCam(this.cam, this.vehicle);
      resetLapTimer(this.lapTimer);
      racerSound.startRace();
    } else if (this.state === "RACE" && startPressed) {
      this.state = "PAUSE";
      this._pauseRow = 0;
      this._prevAxisX = this.input.axisX;
      this._prevAxisY = this.input.axisY;
      this._settingsHeld = 0;
      racerSound.duck();
    } else if (this.state === "PAUSE") {
      this._tickPause();
    }

    // ---- Fixed-step simulation ----------------------------------------------------
    this._acc += dt;
    while (this._acc >= STEP_MS) {
      this._acc -= STEP_MS;
      this.frame++;
      if (this.state === "RACE") this._step();
      else if (this.state === "TITLE") this._titleAngle += 0.15;
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

  _tickPause() {
    const inp = this.input;
    const ROWS = 4; // 0=Resume, 1=SFX Vol, 2=Music Vol, 3=Fullscreen

    const startPressed = inp.justPressed(BTN_FLAGS.START);
    const aPressed = inp.justPressed(BTN_FLAGS.A);

    // Edge-detect axis inputs
    const prevY = this._prevAxisY;
    const prevX = this._prevAxisX;
    const axY = inp.axisY;
    const axX = inp.axisX;
    const justDown  = axY >  0.4 && prevY <=  0.4;
    const justUp    = axY < -0.4 && prevY >= -0.4;
    const justRight = axX >  0.4 && prevX <=  0.4;
    const justLeft  = axX < -0.4 && prevX >= -0.4;
    this._prevAxisY = axY;
    this._prevAxisX = axX;

    // Navigate rows (W/S or D-pad up/down)
    if (justDown || inp.justPressed(BTN_FLAGS.B)) this._pauseRow = (this._pauseRow + 1) % ROWS;
    if (justUp)                                   this._pauseRow = (this._pauseRow + ROWS - 1) % ROWS;

    // Confirm: Start always resumes, A on RESUME row also resumes
    if (startPressed || (aPressed && this._pauseRow === 0)) {
      this.state = "RACE";
      return;
    }

    if (aPressed && this._pauseRow === 3) {
      this.toggleFullscreen();
      return;
    }

    // Slider adjust with auto-repeat (A/D or left stick)
    const hDir = axX > 0.4 ? 1 : axX < -0.4 ? -1 : 0;
    hDir !== 0 ? this._settingsHeld++ : (this._settingsHeld = 0);
    const fire = (justLeft || justRight) ||
                 this._settingsHeld === 1 ||
                 (this._settingsHeld > 20 && this._settingsHeld % 5 === 0);

    if (fire && hDir !== 0 && this._pauseRow > 0 && this._pauseRow < 3) {
      const step = 0.05;
      const v = racerSound.getVolumes();
      if (this._pauseRow === 1) {
        racerSound.setSfxVol(Math.max(0, Math.min(1, v.sfx + hDir * step)));
      } else {
        racerSound.setMusicVol(Math.max(0, Math.min(1, v.music + hDir * step)));
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

    // Title screen orbits the track center; other states use the chase cam
    let cam = this.cam;
    if (this.state === "TITLE" || this.state === "LOADING") {
      const a = this._titleAngle;
      cam = {
        x: v.x + sinDeg(a) * 16,
        y: v.y + 6,
        z: v.z + cosDeg(a) * 16,
        yaw: a + 180,
        pitch: 16,
        fovMul: 1,
      };
    }

    clearSky(rd, cam.yaw, this.frame);
    this.sky.blit(rd, cam.yaw, cam.pitch);

    if (this.state !== "LOADING") {
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
    if (this.state === "LOADING") drawLoading(rd, this.frame, this.hudFonts);
    else if (this.state === "TITLE") drawTitle(rd, this.frame, this.hudFonts);
    else {
      drawRacerHUD(rd, v, this.frame, this.hudFonts, this.place, this.track, this.lapTimer);
      if (this.state === "PAUSE") {
        const vols = racerSound.getVolumes();
        drawPause(rd, this._pauseRow, vols.sfx, vols.music, this.hudFonts, this.isFullscreen());
      }
    }

    // Screen fade during respawn for a clean transition
    const fade = v.respawnT > 0
      ? Math.min(1, Math.sin((v.respawnT / 45) * Math.PI) * 0.9)
      : 0;
    present(rd, 0, fade);
  }
}

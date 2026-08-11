/**
 * racer/vehicle.js — Phase 1 arcade vehicle physics.
 *
 * Roadmap coverage:
 *  1.1 Movement model — accel/top speed, speed-sensitive steering,
 *      handbrake drift with countersteer angle control, drift charge → boost.
 *  1.2 Collision & wall bounce — spline-border sphere collision, shallow-angle
 *      bounce with speed loss, extra "sticky" drag to punish wall riding.
 *  1.3 Ground detection & jumps — spline-slope launch, ramp lip auto-boost,
 *      in-air pitch control with flip reward, landing speed retention,
 *      fall-off respawn.
 *
 * All units are per-frame at a fixed 60Hz step (matches engine convention).
 */
import { sinDeg, cosDeg } from "../engine/luts.js";
import { queryTrack, groundHeightAt, RUMBLE_W } from "./track.js";
import { tunable } from "../engine/tunable.js";

// ---- Tuning (single source of truth for game feel) --------------------------
// Wrapped in tunable() so every value is a live editor slider. All values are
// read fresh each physics step, so changes apply instantly (restart:false).
const S = (min, max, step) => ({ min, max, step, restart: false });

// Contact radius for solid geo obstacles (islands/mountains/rings/buildings).
// Deliberately larger than the road-border carRadius (0.05 — a near-point) so
// the car visibly bumps into off-road geo instead of clipping through it.
// Matches the ~car-width feel used by car-vs-car collision (0.85 combined).
const GEO_COLLIDE_RADIUS = 0.8;

export const TUNE = tunable("vehicle", {
  // Speed
  topSpeed:      2.5,    // world units / frame
  reverseMax:    0.15,
  accel:         0.002,
  brakeDecel:    0.005,
  rollingDrag:   0.9,      // per-frame retention with no throttle
  airDrag:       0.5,

  // Steering
  turnMax:       1.5,    // deg/frame at optimal speed
  turnSpeedRef:  0.23,   // speed where full turn rate is reached
  turnHighFalloff: 1.95, // higher = less steering at top speed
  airSteerMul:   0.05,

  // Grip / drift
  gripLat:       0.4,    // lateral velocity retention (normal)
  gripLatDrift:  0.995,  // lateral velocity retention (drifting = slidey)
  gripLatAir:    0.995,
  driftMinSpeed: 0.5,
  driftMinSteer: 0.25,
  driftYawBase:  0.7,    // deg/frame auto-rotation while drifting
  driftYawSteer: 1.15,   // extra deg/frame from steering with the drift
  driftFwdDrag:  0.99,
  handbrakeDrag: 1,      // straight-line handbrake (no drift)

  // Drift charge → boost (tiers 1/2/3: blue / orange / purple)
  chargeRate:    4,      // per frame scaled by drift angle
  tierCharge1:   15,
  tierCharge2:   75,
  tierCharge3:   150,
  tierBoost1:    15,     // boost duration (frames) per tier
  tierBoost2:    50,
  tierBoost3:    100,
  boostAccel:    0.005,
  boostTopMul:   1.8,

  // Vertical
  gravity:       0.005,
  maxFall:       8.0,
  rampLipBoost:  0.5,    // extra vy at a flagged ramp lip
  launchDropGate: 32,     // ground dropping faster than this/frame → airborne
  groundFollow:   1.0,  // grounded descent ease — smoother downhill/ramp steps
  groundFollowUp: 1.0,  // grounded climb ease — tracks rising ground tightly
  pitchTgtSmooth: 0.8,   // EMA on the slope-pitch target — kills teeter-totter
  pitchFollow:    0.25,  // car pitch lerp toward the smoothed slope target
  landHardVy:    -0.25,
  landHardLoss:  0.005,    // speed retention on a hard landing
  airPitchRate:  1,      // deg/frame in-air pitch control
  flipRewardDeg: 120,
  flipBoostFrames: 180,

  // Walls
  carRadius:     0.05,
  wallBounce:    1.0,
  wallSpeedLoss: 0.5,      // scaled by impact normal speed
  wallStickyDrag: -0.005, // shallow-angle high-speed anti-wall-riding drag
  wallTopHeight: 0.5,    // walls only block below this height above road

  // Off-road (grass/dirt beyond the walls) — driving off-course is possible
  // but severely punished. WALL_SOLID "random" stretches leave gaps in the
  // walls (see track.js); beyond them the car rides track.offroadY.
  offroadTopMul: 0.5,    // top speed fraction while off-road
  offroadDrag:   1.0,   // per-frame speed retention off-road
  offroadGrip:   0.5,    // lateral-retention multiplier off-road (looser)
  roadSnapHeight: 2,     // only ride the deck if within this vertical band

  // Respawn
  fallKillDepth: 64,     // below road level → respawn
  respawnFrames: 45,
}, {
  topSpeed:       S(0.4, 2.5, 0.01),
  reverseMax:     S(0.1, 1.0, 0.01),
  accel:          S(0.002, 0.05, 0.0005),
  brakeDecel:     S(0.005, 0.08, 0.001),
  rollingDrag:    S(0.98, 1.0, 0.0005),
  airDrag:        S(0.99, 1.0, 0.0001),
  turnMax:        S(1.0, 8.0, 0.1),
  turnSpeedRef:   S(0.05, 1.0, 0.01),
  turnHighFalloff:S(0.0, 3.0, 0.05),
  airSteerMul:    S(0.0, 1.0, 0.05),
  gripLat:        S(0.4, 0.99, 0.005),
  gripLatDrift:   S(0.8, 0.995, 0.005),
  gripLatAir:     S(0.9, 1.0, 0.001),
  driftMinSpeed:  S(0.1, 1.0, 0.01),
  driftMinSteer:  S(0.05, 0.9, 0.05),
  driftYawBase:   S(0.3, 4.0, 0.05),
  driftYawSteer:  S(0.0, 4.0, 0.05),
  driftFwdDrag:   S(0.99, 1.0, 0.0005),
  handbrakeDrag:  S(0.9, 1.0, 0.001),
  chargeRate:     S(0.2, 4.0, 0.1),
  tierCharge1:    S(10, 200, 5),
  tierCharge2:    S(50, 400, 5),
  tierCharge3:    S(100, 600, 5),
  tierBoost1:     S(5, 120, 1),
  tierBoost2:     S(10, 180, 1),
  tierBoost3:     S(15, 240, 1),
  boostAccel:     S(0.005, 0.1, 0.001),
  boostTopMul:    S(1.0, 1.8, 0.01),
  gravity:        S(0.01, 0.12, 0.001),
  maxFall:        S(0.3, 2.5, 0.05),
  rampLipBoost:   S(0.0, 0.6, 0.01),
  launchDropGate: S(0.1, 6.0, 0.05),
  groundFollow:   S(0.1, 1.0, 0.01),
  groundFollowUp: S(0.1, 1.0, 0.01),
  pitchTgtSmooth: S(0.05, 1.0, 0.01),
  pitchFollow:    S(0.05, 0.8, 0.01),
  landHardVy:     S(-1.0, -0.05, 0.01),
  landHardLoss:   S(0.7, 1.0, 0.005),
  airPitchRate:   S(1.0, 8.0, 0.1),
  flipRewardDeg:  S(120, 360, 10),
  flipBoostFrames:S(10, 180, 5),
  carRadius:      S(0.05, 2.5, 0.05),
  wallBounce:     S(0.0, 2.0, 0.02),
  wallSpeedLoss:  S(0.0, 1.5, 0.05),
  wallStickyDrag: S(-0.05, 1.0, 0.001),
  wallTopHeight:  S(0.5, 6.0, 0.1),
  offroadTopMul:  S(0.1, 1.0, 0.01),
  offroadDrag:    S(0.90, 1.0, 0.001),
  offroadGrip:    S(0.5, 2.0, 0.05),
  roadSnapHeight: S(0.5, 12.0, 0.1),
  fallKillDepth:  S(5, 80, 1),
  respawnFrames:  S(10, 180, 5),
}, { label: "Vehicle Physics" });

/** Charge thresholds for the 3 drift tiers (live tunable values). */
export function tierCharges() {
  return [TUNE.tierCharge1, TUNE.tierCharge2, TUNE.tierCharge3];
}
function tierBoostFrames(tier) {
  return [TUNE.tierBoost1, TUNE.tierBoost2, TUNE.tierBoost3][tier];
}

export function createVehicle(track) {
  const s = track.samples[track.spawnIdx];
  const yaw = yawFromDir(s.fx, s.fz);
  return {
    x: s.x, y: s.y, z: s.z,
    vx: 0, vy: 0, vz: 0,
    yaw,                    // heading, degrees (forward = sin/cos convention)
    speedF: 0,              // signed forward speed (cached for HUD)
    grounded: true,
    airTime: 0,
    // drift
    drifting: false,
    driftDir: 0,
    driftAngle: 0,          // degrees between velocity and heading
    charge: 0,
    tier: -1,               // current charge tier (-1 none, 0/1/2)
    boostT: 0,
    boostTier: 0,
    // in-air rotation
    pitch: 0,               // visual + air-control pitch (deg, +nose up)
    roll: 0,                // visual lean (deg)
    flipAccum: 0,
    flips: 0,
    _pitchTgt: 0,           // smoothed slope-pitch target (teeter-totter guard)
    // track
    trackIdx: track.spawnIdx,
    lastSafeIdx: track.spawnIdx,
    prevGroundY: s.y,
    // FX / status
    wallHitT: 0,
    landT: 0,
    respawnT: 0,
    justBoosted: 0,
    offroad: false,     // riding the off-road plain (speed penalty active)
    // mileage ticker (world units accumulated, ≈ meters)
    odometer: 0,
  };
}

function yawFromDir(fx, fz) {
  return (Math.atan2(fx, fz) * 180) / Math.PI;
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ---- Main step (fixed 60Hz) --------------------------------------------------
// controls: { throttle, brake, steer(-1..1), handbrake, pitchIn(-1..1), reset }
export function stepVehicle(v, controls, track) {
  if (v.respawnT > 0) {
    v.respawnT--;
    if (v.respawnT === 0) placeAtSample(v, track, v.lastSafeIdx);
    return;
  }
  if (controls.reset) { respawn(v); return; }

  const fx = sinDeg(v.yaw), fz = cosDeg(v.yaw);
  const px = -fz, pz = fx;                       // right perpendicular

  // Decompose velocity into heading frame
  let speedF = v.vx * fx + v.vz * fz;
  let latV   = v.vx * px + v.vz * pz;

  // ---- 1.1 Drift state machine ---------------------------------------------
  if (!v.drifting) {
    if (controls.handbrake && v.grounded && speedF > TUNE.driftMinSpeed &&
        Math.abs(controls.steer) > TUNE.driftMinSteer) {
      v.drifting = true;
      v.driftDir = Math.sign(controls.steer);
      v.charge = 0;
      v.tier = -1;
      latV += -v.driftDir * speedF * 0.12;       // entry kick-out
    }
  } else {
    const lowSpeed = speedF < TUNE.driftMinSpeed * 0.6;
    if (!controls.handbrake || !v.grounded || lowSpeed) {
      // Release → boost by tier reached
      if (v.tier >= 0 && !lowSpeed) {
        v.boostT = Math.max(v.boostT, tierBoostFrames(v.tier));
        v.boostTier = v.tier;
        v.justBoosted = 18;
      }
      v.drifting = false;
      v.driftDir = 0;
      v.charge = 0;
      v.tier = -1;
    }
  }

  // ---- 1.1 Steering ----------------------------------------------------------
  const absSpeed = Math.abs(speedF);
  const spinUp   = clamp(absSpeed / TUNE.turnSpeedRef, 0, 1);       // no curb-spin
  const highCut  = 1 / (1 + absSpeed * TUNE.turnHighFalloff);       // stable at speed
  let turnRate   = TUNE.turnMax * spinUp * highCut;
  if (!v.grounded) turnRate *= TUNE.airSteerMul;

  let yawDelta = controls.steer * turnRate * (speedF >= 0 ? 1 : -1);
  if (v.drifting) {
    // Auto-rotate into the drift; steering with it tightens, countersteer widens
    const steerAlong = controls.steer * v.driftDir;                 // -1..1
    yawDelta = v.driftDir * (TUNE.driftYawBase + Math.max(0, steerAlong) * TUNE.driftYawSteer)
             + Math.min(0, steerAlong) * v.driftDir * 0.9;          // countersteer opens the line
    yawDelta *= spinUp;
  }
  v.yaw += yawDelta;

  // ---- 1.1 Longitudinal forces ----------------------------------------------
  const boosting = v.boostT > 0;
  const offroad = v.grounded && v.offroad;
  const effTop = TUNE.topSpeed * (boosting ? TUNE.boostTopMul : 1) * (offroad ? TUNE.offroadTopMul : 1);
  if (v.grounded) {
    if (boosting) {
      speedF += TUNE.boostAccel * (1 - speedF / effTop);
    } else if (controls.throttle) {
      speedF += TUNE.accel * Math.max(0, 1 - speedF / effTop);
    } else if (controls.brake) {
      if (speedF > 0.02) speedF -= TUNE.brakeDecel;
      else speedF = Math.max(-TUNE.reverseMax, speedF - TUNE.accel * 0.6);
    } else {
      speedF *= TUNE.rollingDrag;
    }
    if (v.drifting) speedF *= TUNE.driftFwdDrag;
    else if (controls.handbrake) speedF *= TUNE.handbrakeDrag;
    if (offroad) speedF *= TUNE.offroadDrag;   // grass bleeds speed hard
  } else {
    speedF *= TUNE.airDrag;
    if (boosting) speedF += TUNE.boostAccel * 0.4 * (1 - speedF / effTop);
  }
  if (v.boostT > 0) v.boostT--;
  if (v.justBoosted > 0) v.justBoosted--;

  // ---- 1.1 Lateral grip -------------------------------------------------------
  const grip = !v.grounded ? TUNE.gripLatAir
             : v.drifting  ? TUNE.gripLatDrift
             : TUNE.gripLat;
  const effGrip = (v.grounded && v.offroad) ? grip * TUNE.offroadGrip : grip;
  latV *= effGrip;

  // Recompose velocity in (possibly rotated) heading frame
  const nfx = sinDeg(v.yaw), nfz = cosDeg(v.yaw);
  const npx = -nfz, npz = nfx;
  v.vx = nfx * speedF + npx * latV;
  v.vz = nfz * speedF + npz * latV;

  // Drift angle (velocity vs heading) + charge
  v.driftAngle = (Math.atan2(latV, Math.max(0.05, Math.abs(speedF))) * 180) / Math.PI;
  if (v.drifting && v.grounded && !v.offroad) {   // no drift charge on grass
    const a = Math.abs(v.driftAngle);
    if (a > 6) v.charge += TUNE.chargeRate * (0.5 + a * 0.035);
    let tier = -1;
    const tc = tierCharges();
    for (let i = 0; i < tc.length; i++) if (v.charge >= tc[i]) tier = i;
    v.tier = tier;
  }

  // ---- 1.3 Vertical -----------------------------------------------------------
  if (!v.grounded) {
    v.vy -= TUNE.gravity;
    if (v.vy < -TUNE.maxFall) v.vy = -TUNE.maxFall;
    v.airTime++;
    // In-air pitch control (front/back flips)
    const pin = controls.pitchIn || 0;
    if (Math.abs(pin) > 0.15) {
      v.pitch -= pin * TUNE.airPitchRate;
      v.flipAccum -= pin * TUNE.airPitchRate;
    }
  }

  // ---- Integrate ---------------------------------------------------------------
  v.x += v.vx;
  v.z += v.vz;
  v.y += v.grounded ? 0 : v.vy;

  // ---- Track query ---------------------------------------------------------------
  const q = queryTrack(track, v.x, v.z, v.trackIdx);
  v.trackIdx = q.idx;
  // Horizontally over the road band? (deck height gate is separate so the car
  // can ride the off-road plain beneath a hill without being yanked up to it.)
  const absLat = Math.abs(q.lat);
  const onRoadLat = absLat <= q.hw + TUNE.carRadius && !q.gap;
  const nearDeck = !q.gap && Math.abs(v.y - q.groundY) < TUNE.roadSnapHeight;
  // The road band rides the banked deck; beyond it the grass ramp slopes down
  // to the off-road floor (groundHeightAt — same surface the renderer draws).
  const overRoadBand = absLat <= q.hw + RUMBLE_W;
  const geomGroundY = q.gap ? null : (overRoadBand ? q.groundY : groundHeightAt(track, q));

  // ---- 1.2 Wall collision ---------------------------------------------------------
  // Solid walls only: non-solid stretches (wallSolid false) are drive-through
  // gaps that lead off-road. Gated on the deck band (nearDeck) so a car riding
  // the plain beneath a hill isn't pushed around by invisible walls.
  if (!q.gap && onRoadLat && nearDeck && q.wallSolid &&
      v.y < q.groundY + TUNE.wallTopHeight) {
    const limit = q.hw - TUNE.carRadius * 0.6;
    if (Math.abs(q.lat) > limit) {
      const side = Math.sign(q.lat);
      const pen = Math.abs(q.lat) - limit;
      // Push back inside the border
      v.x -= q.px * side * pen;
      v.z -= q.pz * side * pen;
      // Inward wall normal
      const nx = -q.px * side, nz = -q.pz * side;
      const vn = v.vx * nx + v.vz * nz;
      if (vn < 0) {
        const speed = Math.hypot(v.vx, v.vz) || 0.0001;
        // Reflect normal component (soft bounce)
        v.vx -= (1 + TUNE.wallBounce) * vn * nx;
        v.vz -= (1 + TUNE.wallBounce) * vn * nz;
        // Speed loss scales with how head-on the impact was
        const loss = clamp(Math.abs(vn) * TUNE.wallSpeedLoss, 0, 0.5);
        v.vx *= 1 - loss;
        v.vz *= 1 - loss;
        // Sticky wall: shallow scrape at high speed still bleeds speed
        if (Math.abs(vn) < speed * 0.18 && speed > 0.5) {
          v.vx *= TUNE.wallStickyDrag;
          v.vz *= TUNE.wallStickyDrag;
        }
        if (Math.abs(vn) > 0.10) v.wallHitT = 10;
        if (Math.abs(vn) > 0.28) { v.charge *= 0.4; }   // hard hits hurt the drift
      }
    }
  }

  // ---- 1.3 Geo obstacle collision (solid walls) ---------------------------------
  // Inset islands / mountains / land-rings / buildings are solid. Circle-vs-AABB
  // push-out against every instance whose height span [baseY, baseY+topY] covers
  // the car's band, in the same spirit as the wall bounce above: a positional
  // push plus a soft velocity bounce along the contact direction. `track.geo` is
  // the per-track GeoSpawner (stamped in racergame.loadLevel); cars fly clean
  // over low geo when airborne above its span.
  if (track.geo && track.geo.resolve) {
    const res = track.geo.resolve(v.x, v.z, GEO_COLLIDE_RADIUS, v.y);
    if (res.blocked && (res.px !== 0 || res.pz !== 0)) {
      v.x += res.px;
      v.z += res.pz;
      const len = Math.hypot(res.px, res.pz) || 0.0001;
      const nx = res.px / len, nz = res.pz / len;
      const vn = v.vx * nx + v.vz * nz;
      if (vn < 0) {
        v.vx -= (1 + TUNE.wallBounce) * vn * nx;
        v.vz -= (1 + TUNE.wallBounce) * vn * nz;
        const loss = clamp(Math.abs(vn) * TUNE.wallSpeedLoss, 0, 0.5);
        v.vx *= 1 - loss;
        v.vz *= 1 - loss;
        if (Math.abs(vn) > 0.10) v.wallHitT = 10;
      }
    }
  }

  // ---- 1.3 Ground detection / landing / launching -----------------------------------
  if (v.grounded) {
    if (geomGroundY === null) {
      // Road vanished under us (gap or off edge) → launch carrying the
      // slope's vertical velocity (ramps throw the car upward)
      v.grounded = false;
      v.vy = clamp(v._slopeVy || 0, -0.3, 0.8);
      if (v._wasRampLip) v.vy += TUNE.rampLipBoost + Math.abs(speedF) * 0.10;
      v.airTime = 0;
      v.flipAccum = 0;
    } else {
      // Ride the deck when on it; beyond the road band ride the grass ramp
      // (slopes down to the floor, so drivers can climb back onto the deck).
      // Still over the road but far below the deck (under a bridge) → the flat
      // floor plane, not a yank up to the deck.
      const targetY = overRoadBand ? (nearDeck ? geomGroundY : track.offroadY) : geomGroundY;
      // Launch gate reads the GROUND's own per-frame drop (prev vs new target),
      // not the car's eased position — a cliff/ramp edge still launches even
      // while the follow-lerp is easing toward the old height.
      if (v.prevGroundY - targetY > TUNE.launchDropGate) {
        // Ground fell away faster than we can follow → airborne with slope vy
        v.grounded = false;
        v.vy = v._slopeVy || 0;
        v.airTime = 0;
        v.flipAccum = 0;
      } else {
        // Follow ground: climbs track the rising surface tightly, but descents
        // EASE toward the ground (exponential lerp) so per-frame ramp/deck
        // slope steps don't turn into y micro-jumps on steep grades. Snap
        // exactly once converged so flats stay glued.
        v._slopeVy = targetY - v.prevGroundY;
        v.prevGroundY = targetY;
        const prevY = v.y;
        const dy = targetY - v.y;
        v.y += dy * (dy > 0 ? TUNE.groundFollowUp : TUNE.groundFollow);
        if (Math.abs(targetY - v.y) < 0.001) v.y = targetY;
        v._groundVy = v.y - prevY;
        v._wasRampLip = q.rampLip;
        v.lastSafeIdxTimer = (v.lastSafeIdxTimer || 0) + 1;
        if (Math.abs(q.lat) < q.hw - 1.5 && !q.ramp && v.lastSafeIdxTimer > 8) {
          v.lastSafeIdx = q.idx;
          v.lastSafeIdxTimer = 0;
        }
      }
    }
  } else {
    // Airborne → check landing
    if (geomGroundY !== null && v.y <= geomGroundY && v.vy <= 0) {
      v.y = geomGroundY;
      v.grounded = true;
      v.prevGroundY = geomGroundY;
      v._slopeVy = 0;
      v.landT = 10;
      // 1.3 Landing impact & speed retention
      if (v.vy < TUNE.landHardVy) {
        v.vx *= TUNE.landHardLoss;
        v.vz *= TUNE.landHardLoss;
      }
      // Flip reward: completed rotation in the air → boost
      if (Math.abs(v.flipAccum) >= TUNE.flipRewardDeg) {
        v.boostT = Math.max(v.boostT, TUNE.flipBoostFrames);
        v.boostTier = Math.max(v.boostTier, 1);
        v.flips++;
        v.justBoosted = 18;
      }
      v.flipAccum = 0;
      v.vy = 0;
      // Snap pitch back on landing (visual lerp continues below)
      v.pitch = ((v.pitch % 360) + 540) % 360 - 180;
      v._pitchTgt = v.pitch;
    }
    // 1.3 Fall-off respawn: fell below the current ground surface (deck, grass
    // ramp, or off-road floor) by fallKillDepth → back to the last safe spot.
    // The ramp means off-road falls land on drivable ground, so there is no
    // separate "stranded far below the deck" case.
    if (geomGroundY !== null
        ? v.y < geomGroundY - TUNE.fallKillDepth
        : v.y < track.offroadY - TUNE.fallKillDepth) {
      respawn(v);
    }
  }

  // Off-road flag for speed/grip penalty (next frame's longitudinal pass uses
  // it; over a gap the car is airborne over the road, not "off-road").
  v.offroad = geomGroundY !== null && !(onRoadLat && nearDeck);

  // ---- Visual pitch / roll ---------------------------------------------------------
  if (v.grounded) {
    // Pitch target from the car's actual (eased) vertical motion. EMA the
    // target so per-segment slope changes don't rock the nose back and forth
    // (teeter-totter), then ease the visual pitch toward it.
    const slopePitch = clamp(
      -Math.atan2(v._groundVy || 0, Math.max(0.05, Math.abs(speedF))) * (180 / Math.PI),
      -60, 60);
    v._pitchTgt += (slopePitch - v._pitchTgt) * TUNE.pitchTgtSmooth;
    v.pitch += (v._pitchTgt - v.pitch) * TUNE.pitchFollow;
    const leanTarget = clamp(-v.driftAngle * 0.30 - controls.steer * absSpeed * 4.5, -14, 14);
    v.roll += (leanTarget - v.roll) * 0.18;
  } else {
    v.roll *= 0.92;
  }
  if (v.wallHitT > 0) v.wallHitT--;
  if (v.landT > 0) v.landT--;

  v.speedF = speedF;
}

function respawn(v) {
  v.respawnT = TUNE.respawnFrames;
  v.vx = v.vy = v.vz = 0;
  v.drifting = false;
  v.charge = 0;
  v.tier = -1;
  v.boostT = 0;
}

function placeAtSample(v, track, idx) {
  const s = track.samples[idx];
  v.x = s.x; v.y = s.y + 0.2; v.z = s.z;
  v.vx = 0; v.vy = 0; v.vz = 0;
  v.yaw = yawFromDir(s.fx, s.fz);
  v.pitch = 0; v.roll = 0; v.flipAccum = 0; v._pitchTgt = 0;
  v.grounded = true;
  v.prevGroundY = s.y;
  v._slopeVy = 0;
  v.trackIdx = idx;
  v.speedF = 0;
}

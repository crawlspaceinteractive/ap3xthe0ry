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
import { queryTrack } from "./track.js";
import { tunable } from "../engine/tunable.js";

// ---- Tuning (single source of truth for game feel) --------------------------
// Wrapped in tunable() so every value is a live editor slider. All values are
// read fresh each physics step, so changes apply instantly (restart:false).
const S = (min, max, step) => ({ min, max, step, restart: false });

export const TUNE = tunable("vehicle", {
  // Speed
  topSpeed:      1.10,   // world units / frame  (~66 u/s)
  reverseMax:    0.34,
  accel:         0.0125,
  brakeDecel:    0.024,
  rollingDrag:   0.9955, // per-frame retention with no throttle
  airDrag:       0.9990,

  // Steering
  turnMax:       3.4,    // deg/frame at optimal speed
  turnSpeedRef:  0.26,   // speed where full turn rate is reached
  turnHighFalloff: 0.85, // higher = less steering at top speed
  airSteerMul:   0.30,

  // Grip / drift
  gripLat:       0.72,   // lateral velocity retention (normal)
  gripLatDrift:  0.945,  // lateral velocity retention (drifting = slidey)
  gripLatAir:    0.995,
  driftMinSpeed: 0.42,
  driftMinSteer: 0.25,
  driftYawBase:  1.25,   // deg/frame auto-rotation while drifting
  driftYawSteer: 1.35,   // extra deg/frame from steering with the drift
  driftFwdDrag:  0.9975,
  handbrakeDrag: 0.975,  // straight-line handbrake (no drift)

  // Drift charge → boost (tiers 1/2/3: blue / orange / purple)
  chargeRate:    1.0,    // per frame scaled by drift angle
  tierCharge1:   55,
  tierCharge2:   130,
  tierCharge3:   230,
  tierBoost1:    22,     // boost duration (frames) per tier
  tierBoost2:    42,
  tierBoost3:    68,
  boostAccel:    0.030,
  boostTopMul:   1.24,

  // Vertical
  gravity:       0.034,
  maxFall:       1.00,
  rampLipBoost:  0.16,   // extra vy at a flagged ramp lip
  launchDropGate: 0.30,  // ground dropping faster than this/frame → airborne
  landHardVy:    -0.34,
  landHardLoss:  0.955,  // speed retention on a hard landing
  airPitchRate:  3.4,    // deg/frame in-air pitch control
  flipRewardDeg: 300,
  flipBoostFrames: 45,

  // Walls
  carRadius:     0.1,
  wallBounce:    1.0,
  wallSpeedLoss: 0.25,   // scaled by impact normal speed
  wallStickyDrag: 0.2, // shallow-angle high-speed anti-wall-riding drag
  wallTopHeight: 0.5,    // walls only block below this height above road

  // Respawn
  fallKillDepth: 26,     // below road level → respawn
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
  launchDropGate: S(0.05, 1.0, 0.01),
  landHardVy:     S(-1.0, -0.05, 0.01),
  landHardLoss:   S(0.7, 1.0, 0.005),
  airPitchRate:   S(1.0, 8.0, 0.1),
  flipRewardDeg:  S(120, 360, 10),
  flipBoostFrames:S(10, 180, 5),
  carRadius:      S(0.4, 2.5, 0.05),
  wallBounce:     S(0.0, 1.0, 0.02),
  wallSpeedLoss:  S(0.0, 1.5, 0.05),
  wallStickyDrag: S(0.9, 1.0, 0.001),
  wallTopHeight:  S(0.5, 6.0, 0.1),
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
    // track
    trackIdx: track.spawnIdx,
    lastSafeIdx: track.spawnIdx,
    prevGroundY: s.y,
    // FX / status
    wallHitT: 0,
    landT: 0,
    respawnT: 0,
    justBoosted: 0,
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
  const effTop = TUNE.topSpeed * (boosting ? TUNE.boostTopMul : 1);
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
  latV *= grip;

  // Recompose velocity in (possibly rotated) heading frame
  const nfx = sinDeg(v.yaw), nfz = cosDeg(v.yaw);
  const npx = -nfz, npz = nfx;
  v.vx = nfx * speedF + npx * latV;
  v.vz = nfz * speedF + npz * latV;

  // Drift angle (velocity vs heading) + charge
  v.driftAngle = (Math.atan2(latV, Math.max(0.05, Math.abs(speedF))) * 180) / Math.PI;
  if (v.drifting && v.grounded) {
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
  const onRoad = Math.abs(q.lat) <= q.hw + TUNE.carRadius && !q.gap;
  const groundY = onRoad ? q.groundY : null;

  // ---- 1.2 Wall collision ---------------------------------------------------------
  // Walls exist wherever road exists (non-gap) and only up to wallTopHeight.
  if (!q.gap && v.y < q.groundY + TUNE.wallTopHeight) {
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

  // ---- 1.3 Ground detection / landing / launching -----------------------------------
  if (v.grounded) {
    if (groundY === null) {
      // Road vanished under us (gap or off edge) → launch carrying the
      // slope's vertical velocity (ramps throw the car upward)
      v.grounded = false;
      v.vy = clamp(v._slopeVy || 0, -0.3, 0.8);
      if (v._wasRampLip) v.vy += TUNE.rampLipBoost + Math.abs(speedF) * 0.10;
      v.airTime = 0;
      v.flipAccum = 0;
    } else {
      const dy = groundY - v.y;
      if (dy < -TUNE.launchDropGate) {
        // Ground fell away faster than we can follow → airborne with slope vy
        v.grounded = false;
        v.vy = v._slopeVy || 0;
        v.airTime = 0;
        v.flipAccum = 0;
      } else {
        // Follow ground (snaps up small steps, rides slopes)
        v._slopeVy = groundY - v.prevGroundY;
        v.prevGroundY = groundY;
        v.y = groundY;
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
    if (groundY !== null && v.y <= groundY && v.vy <= 0) {
      v.y = groundY;
      v.grounded = true;
      v.prevGroundY = groundY;
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
    }
    // 1.3 Fall-off respawn
    if (v.y < q.groundY - TUNE.fallKillDepth || v.y < -TUNE.fallKillDepth) {
      respawn(v);
    }
  }

  // ---- Visual pitch / roll ---------------------------------------------------------
  if (v.grounded) {
    const slopePitch = -Math.atan2(v._slopeVy || 0, Math.max(0.05, Math.abs(speedF))) * (180 / Math.PI);
    v.pitch += (slopePitch - v.pitch) * 0.25;
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
  v.pitch = 0; v.roll = 0; v.flipAccum = 0;
  v.grounded = true;
  v.prevGroundY = s.y;
  v._slopeVy = 0;
  v.trackIdx = idx;
  v.speedF = 0;
}

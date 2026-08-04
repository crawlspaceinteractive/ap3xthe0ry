/**
 * racer/chasecam.js — Phase 1.4 dynamic third-person chase camera.
 *
 *  - Smoothed yaw orbit that lags into corners (extra lag while drifting so
 *    the car visibly rotates under the camera).
 *  - Speed-dependent distance + height.
 *  - Lateral offset during drift (camera swings outside the slide).
 *  - Look-ahead aim point + FOV widening with speed/boost.
 *  - Track floor clamp (never dips below the road surface).
 *  - Instant rear-view toggle (hold), computed from yaw+180 without
 *    polluting the smoothing state.
 */
import { sinDeg, cosDeg } from "../engine/luts.js";
import { queryTrack } from "./track.js";
import { tunable } from "../engine/tunable.js";

const S = (min, max, step) => ({ min, max, step, restart: false });

const CAM = tunable("chasecam", {
  baseDist:   5.6,
  distSpeed:  3.0,   // + per unit of speed
  baseHeight: 2.3,
  heightSpeed: 0.9,
  yawLag:     0.14,  // normal follow tightness
  yawLagDrift: 0.075,
  latMax:     2.2,   // max drift lateral offset
  latRate:    0.09,
  lookAhead:  4.5,   // aim this far ahead of the car
  lookHeight: 1.35,  // aim height above car
  fovRate:    0.07,
  floorPad:   1.0,
}, {
  baseDist:    S(2.0, 14.0, 0.1),
  distSpeed:   S(0.0, 8.0, 0.1),
  baseHeight:  S(0.8, 8.0, 0.1),
  heightSpeed: S(0.0, 4.0, 0.05),
  yawLag:      S(0.02, 0.5, 0.005),
  yawLagDrift: S(0.02, 0.3, 0.005),
  latMax:      S(0.0, 6.0, 0.1),
  latRate:     S(0.02, 0.3, 0.005),
  lookAhead:   S(0.0, 12.0, 0.25),
  lookHeight:  S(0.0, 4.0, 0.05),
  fovRate:     S(0.01, 0.3, 0.005),
  floorPad:    S(0.2, 3.0, 0.05),
}, { label: "Chase Camera" });

export function createChaseCam(v) {
  const fx = sinDeg(v.yaw), fz = cosDeg(v.yaw);
  return {
    // engine camera fields
    x: v.x - fx * CAM.baseDist,
    y: v.y + CAM.baseHeight,
    z: v.z - fz * CAM.baseDist,
    yaw: v.yaw,
    pitch: 10,
    fovMul: 1,
    // smoothing state
    _yaw: v.yaw,
    _dist: CAM.baseDist,
    _h: CAM.baseHeight,
    _lat: 0,
    _fov: 1,
    rear: false,
  };
}

function angleLerp(a, b, t) {
  const d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export function updateChaseCam(cam, v, track, rearHeld) {
  const speed = Math.abs(v.speedF);

  // ---- Smoothed orbit yaw ---------------------------------------------------
  const lag = v.drifting ? CAM.yawLagDrift : CAM.yawLag;
  cam._yaw = angleLerp(cam._yaw, v.yaw, lag);
  cam.rear = !!rearHeld;
  const useYaw = cam.rear ? cam._yaw + 180 : cam._yaw; // instant flip
  const fx = sinDeg(useYaw), fz = cosDeg(useYaw);
  const px = -fz, pz = fx;

  // ---- Distance / height / lateral targets ----------------------------------
  cam._dist += (CAM.baseDist + speed * CAM.distSpeed - cam._dist) * 0.10;
  cam._h    += (CAM.baseHeight + speed * CAM.heightSpeed - cam._h) * 0.10;
  // Swing outside the drift: driftAngle is signed (velocity vs heading)
  const latT = v.drifting ? clamp(v.driftAngle * 0.055, -CAM.latMax, CAM.latMax) : 0;
  cam._lat += (latT - cam._lat) * CAM.latRate;

  let cx = v.x - fx * cam._dist + px * cam._lat;
  let cz = v.z - fz * cam._dist + pz * cam._lat;
  let cy = v.y + cam._h;

  // ---- Track floor clamp (don't sink into the road behind the car) ----------
  const q = queryTrack(track, cx, cz, v.trackIdx);
  if (!q.gap && Math.abs(q.lat) < q.hw + 2.5 && cy < q.groundY + CAM.floorPad) {
    cy = q.groundY + CAM.floorPad;
  }

  // ---- Wall-hit shake ---------------------------------------------------------
  if (v.wallHitT > 0) {
    const s = v.wallHitT * 0.035;
    cx += (Math.random() - 0.5) * s;
    cy += (Math.random() - 0.5) * s;
    cz += (Math.random() - 0.5) * s;
  }

  cam.x = cx; cam.y = cy; cam.z = cz;

  // ---- Aim: look-ahead point --------------------------------------------------
  const tx = v.x + fx * CAM.lookAhead;
  const tz = v.z + fz * CAM.lookAhead;
  const ty = v.y + CAM.lookHeight;
  const dx = tx - cam.x, dz = tz - cam.z;
  cam.yaw = (Math.atan2(dx, dz) * 180) / Math.PI;
  const dd = Math.hypot(dx, dz) || 0.001;
  cam.pitch = (Math.atan2(cam.y - ty, dd) * 180) / Math.PI;

  // ---- FOV: widen (fovMul < 1) with speed and boost ---------------------------
  const fovT = 1 / (1 + speed * 0.16 + (v.boostT > 0 ? 0.12 : 0));
  cam._fov += (fovT - cam._fov) * CAM.fovRate;
  cam.fovMul = cam._fov;
}

/** Hard-snap the camera behind the vehicle (after respawn). */
export function snapChaseCam(cam, v) {
  cam._yaw = v.yaw;
  cam._lat = 0;
  const fx = sinDeg(v.yaw), fz = cosDeg(v.yaw);
  cam.x = v.x - fx * cam._dist;
  cam.z = v.z - fz * cam._dist;
  cam.y = v.y + cam._h;
}

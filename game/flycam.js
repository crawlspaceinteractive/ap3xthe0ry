/**
 * flycam.js — debug fly camera for level inspection (Phase 2.1)
 *
 * Toggled with F during gameplay (see game.js). While active the world is
 * frozen (no physics / AI / particles) and the camera flies free:
 *
 *   WASD / left stick   move on the horizontal plane (camera-relative)
 *   SPACE / A           ascend          CTRL / RT   descend
 *   Q,E / right stick X yaw             R,V / right stick Y  pitch
 *   SHIFT / LT          3× speed        F           exit flycam
 */
import { BTN_FLAGS } from "../engine/input.js";
import { sinDeg, cosDeg } from "../engine/luts.js";

export function createFlycam(camera) {
  return {
    x: camera.x, y: camera.y, z: camera.z,
    yaw: camera.yaw || 0,
    pitch: camera.pitch || 0,
    speed: 0.9,
  };
}

export function stepFlycam(fly, inp) {
  // ── Yaw: Q/E keys or right-stick X ──
  fly.yaw += inp.orbitX * 2.6;
  if (fly.yaw < 0) fly.yaw += 360;
  if (fly.yaw >= 360) fly.yaw -= 360;

  // ── Pitch: R (up) / V (down) or right-stick Y ──
  let pd = 0;
  if (inp.isKeyDown?.("KeyR")) pd += 1.8;
  if (inp.isKeyDown?.("KeyV")) pd -= 1.8;
  pd += -(inp.orbitY || 0) * 2.2;
  fly.pitch += pd;
  if (fly.pitch > 85) fly.pitch = 85;
  if (fly.pitch < -85) fly.pitch = -85;

  // ── Translation (camera-relative, yaw 0 = +Z per engine convention) ──
  const spd = fly.speed * (inp.isDown(BTN_FLAGS.LT) ? 3.0 : 1.0);
  const fx = sinDeg(fly.yaw | 0), fz = cosDeg(fly.yaw | 0);
  const fwd = -inp.axisY;   // W = forward
  const str = inp.axisX;    // D = strafe right; right vector = (fz, -fx)
  fly.x += (fx * fwd + fz * str) * spd;
  fly.z += (fz * fwd - fx * str) * spd;
  if (inp.isDown(BTN_FLAGS.A))  fly.y += spd;  // Space
  if (inp.isDown(BTN_FLAGS.RT)) fly.y -= spd;  // Ctrl
}

/** Pin the engine camera (position + targets) to the flycam each frame so
 *  nothing lerps it back toward the player while inspecting. */
export function applyFlycamToCamera(fly, camera) {
  camera.x = camera.targetX = fly.x;
  camera.y = camera.targetY = fly.y;
  camera.z = camera.targetZ = fly.z;
  camera.yaw = camera.targetYaw = fly.yaw;
  camera.pitch = camera.targetPitch = fly.pitch;
  camera.lookPitch = 0;
}

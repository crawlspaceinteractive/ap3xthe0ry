/**
 * physics.js — Player movement system (Spec Section VI)
 *
 *   Momentum preserved across states.
 *   Air control < ground control.
 *   State modifies LUT-driven physics.
 *
 * Receives: player object, ctx { axisX, axisY, movementMode, jumpMode, dt },
 *           and the world (for collision against floating islands).
 *
 * FIXED-POINT NOTES
 * -----------------
 *   Gravity, damping, and speed-cap arithmetic use 8.8 fixed point (×256)
 *   so that all per-frame accumulation uses integer shifts instead of floats.
 *   Player position/velocity are still stored as ordinary JS numbers (float64)
 *   but every in-loop multiply is replaced with integer >> 8.
 *
 *   Damping encode: damp256 = round(damp * 256)
 *     vx *= damp   →   vx = (vx * damp256 + 128) >> 8
 *   Gravity encode: grav256 = round(grav * 256)
 *     vy -= grav   →   vy -= grav256 / 256   (one division, outside frame loop)
 *
 *   In practice JS engines will JIT these to native integer ops.
 */
import { PHYSICS_LUT, MOVE, JUMPM, sinDeg, cosDeg } from "../engine/luts.js";
import { STATE } from "../engine/state.js";

// ---- Physics constants (all in world units per frame) ---------------------
const JUMP_IMPULSE        = 0.26;
const DOUBLE_JUMP_IMPULSE = 0.22;

// Gravity variants — stored as integers (×65536 = 16.16 fixed point)
// Actual value: fp >> 16
const _FP = 65536;
const RISE_GRAVITY_FP       = (0.008 * _FP + 0.5) | 0;   // 524
const NORMAL_GRAVITY_AIR_FP = (0.030 * _FP + 0.5) | 0;   // 1966

// Turn rates in degrees/frame
const TURN_RATE_GROUND = 3.6;
const TURN_RATE_AIR    = 2.2;

// ---- Platforming feel (Phase 1.1) -----------------------------------------
const COYOTE_FRAMES      = 7;     // ~0.12s grace after walking off a ledge
const JUMP_BUFFER_FRAMES = 7;     // ~0.12s early-press buffer before landing
const JUMP_CUT_MULT      = 0.45;  // vy multiplier on early jump release

// ---- Slope handling (Phase 1.3) --------------------------------------------
// Faces with |normalY| >= 0.707 (≤45°) are walkable; steeper landable faces
// (0.25..0.707) are slide surfaces — player grips but is pushed downhill.
const SLOPE_WALK_COS = 0.707;
const SLIDE_ACCEL    = 0.022;

// Per-mode damping pre-baked as 16.16 fixed-point integers
// damp_fp = round(damp * 65536)
const _groundDamp256 = new Int32Array(5);
const _airDamp256    = new Int32Array(5);
const _accel         = new Float32Array(5);
const _maxSpeed      = new Float32Array(5);
const _maxFall       = new Float32Array(5);
const _gravFP        = new Int32Array(5);
const _vClamp        = new Float32Array(5).fill(Infinity);

(function bakePhysicsLUT() {
  for (let i = 0; i < PHYSICS_LUT.length; i++) {
    const p = PHYSICS_LUT[i];
    _groundDamp256[i] = (p.groundDamp * 65536 + 0.5) | 0;
    _airDamp256[i]    = (p.airDamp    * 65536 + 0.5) | 0;
    _accel[i]         = p.accel;
    _maxSpeed[i]      = p.maxSpeed;
    _maxFall[i]       = p.maxFall;
    _gravFP[i]        = (p.gravity * _FP + 0.5) | 0;
    _vClamp[i]        = p.vClamp != null ? p.vClamp : -Infinity;
  }
})();

export function stepPhysics(player, world, ctx) {
  const { axisX, axisY, movementMode, jumpMode } = ctx;
  const mi = movementMode | 0; // mode index (integer)

  if (player.state & STATE.FROZEN) return;

  if (player.state & STATE.DEAD) {
    // Dead: apply gravity only, clamp fall speed, integrate position
    player.vy -= _gravFP[mi] / _FP;
    const mf = _maxFall[mi];
    if (player.vy < -mf) player.vy = -mf;
    player.x += player.vx;
    player.y += player.vy;
    player.z += player.vz;
    if (player.y < -20) player.y = -20;
    return;
  }

  // ---- Turn ----------------------------------------------------------------
  const turnRate = (jumpMode === JUMPM.GROUNDED) ? TURN_RATE_GROUND : TURN_RATE_AIR;
  player.yaw += axisX * turnRate;
  if (player.yaw < 0)    player.yaw += 360;
  if (player.yaw >= 360) player.yaw -= 360;

  // ---- Acceleration along player.yaw ----------------------------------------
  const inputForward = -axisY;
  const fx = sinDeg(player.yaw);
  const fz = cosDeg(player.yaw);
  const accel = _accel[mi];
  player.vx += fx * inputForward * accel;
  player.vz += fz * inputForward * accel;

  // Cap horizontal speed
  const maxSpeed = _maxSpeed[mi];
  if (maxSpeed > 0) {
    const horizSp2 = player.vx * player.vx + player.vz * player.vz;
    const maxSp2   = maxSpeed * maxSpeed;
    if (horizSp2 > maxSp2) {
      // k = maxSpeed / sqrt(horizSp2) via inverse sqrt approx
      // For safety use the exact division (one sqrt per frame max)
      const k = maxSpeed / Math.sqrt(horizSp2);
      player.vx *= k;
      player.vz *= k;
    }
  }

  // ---- Damping — 16.16 fixed-point multiply then >> 16 --------------------
  // vx *= damp   →   vx = vx * damp_fp >> 16
  const dampFP = (jumpMode === JUMPM.GROUNDED) ? _groundDamp256[mi] : _airDamp256[mi];
  player.vx = (player.vx * dampFP) / _FP;
  player.vz = (player.vz * dampFP) / _FP;

  // HIT extra damping (plain multiply — rare code path)
  if (player.state & STATE.HIT) {
    player.vx *= 0.92;
    player.vz *= 0.92;
  }

  // ---- Gravity — 16.16 fixed-point ----------------------------------------
  const isGliding = (player.state & STATE.GLIDE) !== 0;
  let gravFP;
  if (isGliding) {
    gravFP = _gravFP[mi]; // GLIDE row already encodes 0.008
  } else if (!player.grounded && player.vy > 0) {
    gravFP = RISE_GRAVITY_FP;  // floaty ascent for all jumps
  } else {
    gravFP = NORMAL_GRAVITY_AIR_FP;
  }
  player.vy -= gravFP / _FP;

  const mf = _maxFall[mi];
  if (player.vy < -mf) player.vy = -mf;
  const vc = _vClamp[mi];
  if (player.vy < vc) player.vy = vc;

  // ---- Coyote time bookkeeping ---------------------------------------------
  // player.grounded here is LAST frame's collision result — exactly what we
  // want: the grace window starts the frame the player leaves the ground.
  if (player.grounded) {
    player.coyoteFrames = COYOTE_FRAMES;
  } else if (player.coyoteFrames > 0) {
    player.coyoteFrames--;
  }

  // ---- Jump input buffering --------------------------------------------------
  // A press arms a short buffer; the jump executes on the first frame it is
  // legal (e.g. pressed slightly before landing → fires the landing frame).
  if (player._wantJump) {
    player._wantJump = false;
    player.jumpBufferFrames = JUMP_BUFFER_FRAMES;
  }

  // ---- Jump execution (token-gated; physics is authoritative) ---------------
  if (player.jumpBufferFrames > 0) {
    player.jumpBufferFrames--;
    if (player.jumpTokens === 2 && (player.grounded || player.coyoteFrames > 0)) {
      // Ground jump (or coyote jump just after walking off a ledge)
      player.vy = JUMP_IMPULSE;
      player.jumpTokens = 1;
      player.coyoteFrames = 0;
      player.jumpBufferFrames = 0;
      player.grounded = false;
      player.state |= STATE.JUMP;
      player.state &= ~(STATE.DOUBLE_JUMP | STATE.GLIDE);
    } else if (!player.grounded && player.coyoteFrames === 0 && player.jumpTokens >= 1) {
      // Air jump: normal double jump (tokens 1→0), or a forfeited first jump
      // after falling past the coyote window (tokens 2→1, weaker impulse).
      player.vy = DOUBLE_JUMP_IMPULSE;
      player.jumpTokens -= 1;
      player.jumpBufferFrames = 0;
      player.state |= STATE.DOUBLE_JUMP;
      player.state &= ~(STATE.JUMP | STATE.GLIDE);
    }
  }

  // ---- Variable jump height (jump cut) ---------------------------------------
  // Releasing the jump button while still rising trims upward velocity, so
  // tapping A gives a short hop and holding A gives the full arc.
  if (player._wantJumpCut) {
    player._wantJumpCut = false;
    if (!player.grounded && player.vy > 0.06 && !(player.state & STATE.GLIDE)) {
      player.vy *= JUMP_CUT_MULT;
    }
  }

  // ---- Integrate position and resolve platform collision -------------------
  const radius = 0.35;
  const halfH  = 0.5;

  player.x += player.vx;
  player.z += player.vz;
  player.y += player.vy;

  const wasGrounded = player.grounded;
  player.grounded = false;
  player._steepSlope = false;   // set by narrow-phase when landing on >45° face

  // Single AABB collision test — mutates player in place.
  // oneWay (Phase 1.3): platform is solid only from above — land when falling
  // with feet above the top last frame; never side-push, never block ascent,
  // so the player can jump up through it from below.
  function testAABB(px, py, pz, bsx, bsy_half, bsz, topY, oneWay = false) {
    const blockTop    = topY;
    const blockBottom = topY - bsy_half * 2;

    const dx = player.x - px;
    const dz = player.z - pz;
    const overlapX = bsx + radius - (dx < 0 ? -dx : dx);
    const overlapZ = bsz + radius - (dz < 0 ? -dz : dz);

    if (overlapX <= 0 || overlapZ <= 0) return false;

    const playerBottom = player.y - halfH;
    const playerTop    = player.y + halfH;

    if (playerTop <= blockBottom || playerBottom >= blockTop) return false;

    // Top landing.
    // One-way gate: feet must have been at/above the top BEFORE this frame's
    // integration (playerBottom - vy), otherwise we're passing through from
    // below/inside and must not snap up onto the surface.
    if (
      playerBottom <= blockTop + 0.05 &&
      (oneWay
        ? playerBottom - player.vy >= blockTop - 0.05
        : playerBottom >= blockBottom) &&
      player.vy <= 0
    ) {
      player.y = blockTop + halfH;
      player.vy = 0;
      player.grounded = true;
      return true;
    }

    if (oneWay) return false; // never side-push or head-bonk on one-way platforms

    // Side push-out (only when clearly inside the vertical volume)
    if (playerBottom < blockTop - 0.05 && playerTop > blockBottom + 0.05) {
      if (overlapX < overlapZ) {
        player.x += dx > 0 ? overlapX : -overlapX;
        player.vx = 0;
      } else {
        player.z += dz > 0 ? overlapZ : -overlapZ;
        player.vz = 0;
      }
    }
    return false;
  }

  for (const p of world.platforms) {
    if (p.glbModel) {
      // ── GLB face collision ──────────────────────────────────────────────
      // If the model has no baked face data (0-face GLB or load failure),
      // fall through to AABB collision using the platform's half-extents.
      if (!p.glbModel.faceCount || p.glbModel.faceCount === 0) {
        const wx = p.glbWorldX ?? p.x;
        const wy = p.glbWorldY ?? (p.y - p.sy);
        const wz = p.glbWorldZ ?? p.z;
        const scaleMul = p.glbScaleMul ?? 1.0;
        const modelTopY = p.glbModel.topY ?? p.sy ?? 1.0;
        const topYWorld = wy + modelTopY * scaleMul;
        testAABB(wx, wy, wz, p.sx ?? 10, topYWorld - wy, p.sz ?? 10, topYWorld);
        continue;
      }
      // First do a cheap AABB broad-phase using the island's halfW/halfD/topY.
      const wx = p.glbWorldX ?? p.x;
      const wy = p.glbWorldY ?? (p.y - p.sy);
      const wz = p.glbWorldZ ?? p.z;
      const halfW = p.sx;
      const halfD = p.sz;
      const scaleMul = p.glbScaleMul ?? 1.0;
      const aabbTop = wy + p.glbModel.topY * scaleMul;
      const aabbBot = wy - p.glbModel.topY * scaleMul * 2;

      const dxAabb = player.x - wx;
      const dzAabb = player.z - wz;
      if (Math.abs(dxAabb) > halfW + radius * 2 ||
          Math.abs(dzAabb) > halfD + radius * 2) continue;
      if (player.y + halfH < aabbBot || player.y - halfH > aabbTop + 2) continue;

      // Narrow-phase: land on the HIGHEST face under the player's XZ column.
      // Normal sign is ignored for detection (some exporters flip normals);
      // picking the topmost face in the snap window guarantees the player
      // stands on the surface they SEE — collision always matches visuals.
      // (The old code snapped to whichever qualifying face iterated last,
      // which could be an interior/underside face, and a bbox-top AABB
      // "safety net" created an invisible flat floor at peak height over the
      // whole island footprint — both causes of visual/collision mismatch.)
      const faces = p.glbModel.faces;
      const faceCount = p.glbModel.faceCount;
      const feetNow = player.y - halfH;

      let landFaceY = -Infinity;             // highest landing surface found
      let landNX = 0, landNY = 1, landNZ = 0; // true upward normal of that face

      for (let fi = 0; fi < faceCount; fi++) {
        const base = fi * 9;
        // Triangle vertices in world space (faces are pre-baked at model.scale;
        // multiply by scaleMul to match any 2× portal island override)
        const ax = faces[base]     * scaleMul + wx, ay = faces[base + 1] * scaleMul + wy, az = faces[base + 2] * scaleMul + wz;
        const bx = faces[base + 3] * scaleMul + wx, by = faces[base + 4] * scaleMul + wy, bz = faces[base + 5] * scaleMul + wz;
        const cx = faces[base + 6] * scaleMul + wx, cy = faces[base + 7] * scaleMul + wy, cz = faces[base + 8] * scaleMul + wz;

        // Compute face normal (unnormalised for culling)
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;

        // Only collide with upward-facing surfaces (ny > 0) or nearly-vertical walls
        // For landing on top: require ny > 0.25 (tilted faces count too)
        // Also accept faces with nny < -0.25 (downward) since some exporters flip normals
        const nLen = Math.sqrt(nx*nx + ny*ny + nz*nz);
        if (nLen < 0.0001) continue;
        const nny = ny / nLen;

        if (nny > 0.25 || nny < -0.25) {
          // Landing surface candidate — find the Y of the triangle at
          // (player.x, player.z) using barycentric interpolation on XZ plane.
          const px2 = player.x - ax, pz2 = player.z - az;
          const d1x = bx - ax, d1z = bz - az;
          const d2x = cx - ax, d2z = cz - az;
          const denom = d1x * d2z - d1z * d2x;
          if (Math.abs(denom) < 0.0001) continue;
          const u = (px2 * d2z - pz2 * d2x) / denom;
          const v = (d1x * pz2 - d1z * px2) / denom;
          // Slightly relaxed tolerance to handle edge cases and small triangles
          if (u < -0.02 || v < -0.02 || u + v > 1.02) continue;

          // Interpolated Y on the face at player XZ
          const faceY = ay + u * (by - ay) + v * (cy - ay);

          // One-way face platforms (bridge planks): while AIRBORNE, only land
          // if feet were at/above the face BEFORE this frame's integration —
          // jump-through from below stays possible, no snap-up while passing
          // underneath. When grounded-walking (wasGrounded) the gate must NOT
          // apply: on an uphill spline the deck ahead rises by slope×speed per
          // frame (> the 0.05 tolerance), and gating those faces made the
          // player fall through every ascending bridge. Walking follows the
          // slope via the normal snap window instead.
          if (p.oneWay === true && !wasGrounded && feetNow - player.vy < faceY - 0.05) continue;

          // Snap window: face within [feet - 0.15, feet + 0.8].
          // Track only the HIGHEST such face — the visible surface.
          if (feetNow <= faceY + 0.15 && feetNow >= faceY - 0.8 && faceY > landFaceY) {
            landFaceY = faceY;
            // True upward normal (flip if this exporter inverted normals)
            const s = nny >= 0 ? 1 : -1;
            landNX = (nx / nLen) * s;
            landNY = nny * s;
            landNZ = (nz / nLen) * s;
          }
        } else if (Math.abs(nny) < 0.65 && p.oneWay !== true) {
          // Vertical / near-vertical wall — push player out
          // Use the face plane equation for accurate distance from the actual face
          const nnx = nx / nLen, nny2 = ny / nLen, nnz = nz / nLen;
          // Signed distance from player centre to the face plane
          const dist = (player.x - ax) * nnx + (player.y - ay) * nny2 + (player.z - az) * nnz;

          // Only push if player is penetrating from the front side and close enough
          if (dist > -0.05 && dist < radius + 0.1) {
            // Only push out if player body overlaps the vertical span of this face
            const minFaceY = Math.min(ay, by, cy) - 0.05;
            const maxFaceY = Math.max(ay, by, cy) + 0.05;
            if (player.y + halfH > minFaceY && player.y - halfH < maxFaceY) {
              // Also check the player is horizontally near the triangle (XZ proximity)
              const px2 = player.x - ax, pz2 = player.z - az;
              const d1x = bx - ax, d1z = bz - az;
              const d2x = cx - ax, d2z = cz - az;
              const denom = d1x * d2z - d1z * d2x;
              if (Math.abs(denom) > 0.0001) {
                const u = (px2 * d2z - pz2 * d2x) / denom;
                const v = (d1x * pz2 - d1z * px2) / denom;
                // Allow a slightly wider tolerance for walls so we don't clip through
                if (u >= -0.15 && v >= -0.15 && u + v <= 1.15) {
                  const push = radius + 0.1 - dist;
                  player.x += nnx * push;
                  player.z += nnz * push;
                  if (Math.abs(nnx) > Math.abs(nnz)) player.vx = 0;
                  else player.vz = 0;
                }
              }
            }
          }
        }
      }

      // Resolve landing on the single best (highest = visible) face found.
      if (player.vy <= 0 && landFaceY > -Infinity) {
        player.y  = landFaceY + halfH;
        player.vy = 0;
        player.grounded = true;
        // ---- Slope classification (walk ≤45°, slide >45°) ----------------
        if (landNY < SLOPE_WALK_COS) {
          player._steepSlope = true;
          player._slopeNX = landNX;
          player._slopeNZ = landNZ;
        }
      }
      // NOTE: the old bbox-top AABB "safety net" is intentionally REMOVED.
      // It landed the player on an invisible flat floor at the model's PEAK
      // height across the whole island footprint — the root cause of the
      // visual/collision misalignment. Flipped-normal fall-through is now
      // handled by the normal-agnostic highest-face pick above. Faceless
      // models (faceCount === 0) still use the AABB fallback earlier in this
      // branch. Do not re-add the net.
    } else if (p.blocks && p.blocks.length > 1) {
      for (const b of p.blocks) {
        if (b._axisNX !== undefined) continue;
        const bTopY = b.wy + b.sy;
        testAABB(b.wx, b.wy, b.wz, b.sx, b.sy, b.sz, bTopY, b.oneWay === true || p.oneWay === true);
      }
    } else {
      // Bridge planks with baked spline face collision (see game.js
      // _registerBridgeCollision → type "bridge_col") — skip the legacy flat
      // AABB so its invisible flat top can't fight the tilted ribbon faces.
      if (p._faceCollision === true) continue;
      const blockHeight = p.sy != null ? p.sy * 2 : 1.2;
      testAABB(p.x, p.y - blockHeight * 0.5, p.z, p.sx, blockHeight * 0.5, p.sz, p.y, p.oneWay === true);
    }
  }

  // ---- Steep-slope slide (Phase 1.3) ----------------------------------------
  // Standing on a >45° face: push the player downhill along the face's
  // horizontal normal. Ground damping caps this at a steady slide speed;
  // jumping off mid-slide still works (grounded stays true).
  if (player.grounded && player._steepSlope) {
    player.vx += player._slopeNX * SLIDE_ACCEL;
    player.vz += player._slopeNZ * SLIDE_ACCEL;
  }

  // Restore full jump tokens on landing.
  if (player.grounded && !wasGrounded) {
    player.jumpTokens = 2;
  }

  // Death plane
  if (player.y < -20) {
    player.state |= STATE.DEAD;
  }
}

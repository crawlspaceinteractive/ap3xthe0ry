/**
 * racer/scenery.js — Pine tree billboards lining the track sides.
 *
 * Trees are placed at init along both edges of the track, skipping ramp
 * samples. Each tree is a camera-facing textured quad (billboard) with
 * alpha cutout for the pine silhouette. A small per-frame lean simulates
 * wind sway.
 *
 * Renderer integration: build() pushes textured tris into the shared array
 * before the painter sort in racergame._render().
 */
import { buildTexturedFace, rgba } from "../engine/renderer.js";
import { sinDeg, cosDeg } from "../engine/luts.js";
import { loadTexture } from "../engine/textureloader.js";

const CULL_DIST    = 165;
const CULL_DIST_SQ = CULL_DIST * CULL_DIST;
const BEHIND_MARGIN = 16;
const GRASS_W      = 9.0;
const RUMBLE_W     = 0.9;
const TREE_BASE_OFFSET = GRASS_W + RUMBLE_W + 1.5; // outside the grass apron

class Scenery {
  constructor() {
    this._trees = [];
    this._texture = null;
    this._ready = false;
  }

  async load(track) {
    // Load the pine tree texture with cropToContent so wrap-tiling works edge-to-edge
    this._texture = await loadTexture("assets/2D/sprites/pine_sway.gif", { cropToContent: true });
    if (!this._texture) {
      console.warn("[scenery] pine_sway.gif failed to load — trees disabled");
      return;
    }

    // Place trees along the track
    const s = track.samples;
    const n = track.count;
    const trees = [];

    for (let i = 0; i < n; i += 5) {
      const a = s[i];
      // Skip ramp samples (trees on ramps look wrong)
      if (a.ramp) continue;

      for (const side of [-1, 1]) {
        const offset = TREE_BASE_OFFSET + Math.random() * 0.5;
        const jitter = (Math.random() - 0.5) * 1.5;
        trees.push({
          x: a.x + a.px * side * (a.hw + offset) + jitter,
          y: a.y,
          z: a.z + a.pz * side * (a.hw + offset) + jitter,
          phase: Math.random() * Math.PI * 3,
          scale: 10.0 + Math.random() * 0.5,
        });
      }
    }

    this._trees = trees;
    this._ready = true;
    console.log(`[scenery] placed ${trees.length} pine trees`);
  }

  /**
   * Build billboard tris for all visible trees.
   * Pushes into the shared tris array before the painter sort.
   *
   * @param {object} camera - { x, y, z, yaw, pitch, fovMul }
   * @param {number} frame  - current frame counter (for sway animation)
   * @param {Array}  tris   - shared tri array to push into
   */
  build(camera, frame, tris) {
    if (!this._ready || !this._texture) return;

    const camFx = sinDeg(camera.yaw);
    const camFz = cosDeg(camera.yaw);

    for (const tree of this._trees) {
      const dx = tree.x - camera.x;
      const dz = tree.z - camera.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > CULL_DIST_SQ) continue;
      // Behind-camera cull
      if (dx * camFx + dz * camFz < -BEHIND_MARGIN) continue;

      // Billboard: camera-facing right vector
      const c = cosDeg(camera.yaw);
      const s = sinDeg(camera.yaw);
      const hw = tree.scale;
      const hh = tree.scale;

      // Wind sway: lean the top of the billboard slightly
      const leanX = Math.sin(frame * 0.03 + tree.phase) * 0.3;

      // Build camera-facing textured quad
      // Right vector = (cos(yaw), 0, -sin(yaw))
      const rx = c, rz = -s;
      const lx = tree.x - rx * hw, lz = tree.z - rz * hw;
      const rrx = tree.x + rx * hw, rrz = tree.z + rz * hw;

      // Top points with lean offset
      const topShiftX = rx * leanX, topShiftZ = rz * leanX;

      const worldPts = [
        { x: lx + topShiftX,          y: tree.y + hh, z: lz + topShiftZ,          u: 0, v: 0 },
        { x: rrx + topShiftX,         y: tree.y + hh, z: rrz + topShiftZ,         u: 0.9999, v: 0 },
        { x: rrx,                     y: tree.y,      z: rrz,                     u: 0.9999, v: 0.9999 },
        { x: lx,                      y: tree.y,      z: lz,                      u: 0, v: 0.9999 },
      ];

      const treeTris = buildTexturedFace(worldPts, rgba(255, 255, 255), this._texture, camera);
      for (const t of treeTris) tris.push(t);
    }
  }
}

export function createScenery() {
  return new Scenery();
}

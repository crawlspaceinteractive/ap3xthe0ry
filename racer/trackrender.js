/**
 * racer/trackrender.js — Builds render triangles for the track each frame.
 *
 * Consumes the SAME sample array physics uses, so the rendered road exactly
 * matches the collision boundary. Everything returns engine tri objects
 * ({verts, color, avgZ, texture?}) for the shared sort+draw pass.
 */
import { buildFace, buildTexturedFace, rgba, shadeFace } from "../engine/renderer.js";
import { sinDeg, cosDeg } from "../engine/luts.js";

const CULL_DIST      = 165;   // max sample distance from camera
const CULL_DIST_SQ   = CULL_DIST * CULL_DIST;
const BEHIND_MARGIN  = 16;    // keep samples slightly behind the camera
const RUMBLE_DIST_SQ = 120 * 120;
const GRASS_DIST_SQ  = 90 * 90;
const WALL_H         = 1.7;
const RUMBLE_W       = 0.9;
const GRASS_W        = 9.0;

const ROAD_TINT   = rgba(230, 230, 232);
const GRASS_TINT  = rgba(215, 235, 210);
const RUMBLE_RED  = rgba(205, 45, 45);
const RUMBLE_WHT  = rgba(232, 232, 232);
const WALL_A      = rgba(125, 125, 138);
const WALL_B      = rgba(105, 105, 118);
const CAP_COLOR   = rgba(70, 55, 45);
const GROUND_COL  = rgba(52, 108, 50);
const CHECK_A     = rgba(240, 240, 240);
const CHECK_B     = rgba(25, 25, 28);

export function buildTrackTris(track, tex, camera, frame) {
  const out = [];
  const s = track.samples;
  const n = track.count;

  // ---- Ground plane under everything (camera-centered) ----------------------
  // A flat textured plain at track.minY - 0.4 hides the sky gradient / void
  // below the horizon. Camera-centered grid (subdivided so the grass texture
  // maps with acceptable perspective); UVs are world-anchored so the texture
  // scrolls naturally as the car drives. Pushed to the back via +500 sort bias.
  const gy = track.minY - 0.4;
  if (camera.y > gy) {
    const R = 340; // extends past the fog distance so it meets the horizon
    if (tex.grass) {
      const CELLS = 10;
      const U = 0.07; // same tile scale as the grass aprons → seamless
      const step = R / CELLS;
      for (let cx = 0; cx < CELLS; cx++) {
        const x0 = camera.x + (cx - CELLS / 2) * step;
        const x1 = x0 + step;
        for (let cz = 0; cz < CELLS; cz++) {
          const z0 = camera.z + (cz - CELLS / 2) * step;
          const z1 = z0 + step;
          const gpts = [
            { x: x0, y: gy, z: z0, u: x0 * U, v: z0 * U },
            { x: x1, y: gy, z: z0, u: x1 * U, v: z0 * U },
            { x: x1, y: gy, z: z1, u: x1 * U, v: z1 * U },
            { x: x0, y: gy, z: z1, u: x0 * U, v: z1 * U },
          ];
          for (const t of buildTexturedFace(gpts, GRASS_TINT, tex.grass, camera)) {
            t.avgZ += 500; // force ground behind everything in the painter sort
            out.push(t);
          }
        }
      }
    } else {
      const gpts = [
        { x: camera.x - R, y: gy, z: camera.z - R },
        { x: camera.x + R, y: gy, z: camera.z - R },
        { x: camera.x + R, y: gy, z: camera.z + R },
        { x: camera.x - R, y: gy, z: camera.z + R },
      ];
      for (const t of buildFace(gpts, GROUND_COL, camera)) {
        t.avgZ += 500; // force ground behind everything in the painter sort
        out.push(t);
      }
    }
  }

  const camFx = sinDeg(camera.yaw), camFz = cosDeg(camera.yaw);

  for (let i = 0; i < n; i++) {
    const a = s[i];
    const b = s[(i + 1) % n];

    const dx = a.x - camera.x, dz = a.z - camera.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > CULL_DIST_SQ) continue;
    // Behind-camera cull (with margin so the road under the car never pops)
    if (dx * camFx + dz * camFz < -BEHIND_MARGIN) continue;

    const aL = { x: a.x - a.px * a.hw, z: a.z - a.pz * a.hw };
    const aR = { x: a.x + a.px * a.hw, z: a.z + a.pz * a.hw };
    const bL = { x: b.x - b.px * b.hw, z: b.z - b.pz * b.hw };
    const bR = { x: b.x + b.px * b.hw, z: b.z + b.pz * b.hw };

    // ---- Road surface --------------------------------------------------------
    if (!a.gap) {
      const va = a.dist * 0.22, vb = a.dist * 0.22 + a.segLen * 0.22;
      const pts = [
        { x: aL.x, y: a.y, z: aL.z, u: 0,   v: va },
        { x: aR.x, y: a.y, z: aR.z, u: 1.5, v: va },
        { x: bR.x, y: b.y, z: bR.z, u: 1.5, v: vb },
        { x: bL.x, y: b.y, z: bL.z, u: 0,   v: vb },
      ];
      if (tex.road) {
        for (const t of buildTexturedFace(pts, ROAD_TINT, tex.road, camera)) out.push(t);
      } else {
        for (const t of buildFace(pts, rgba(95, 95, 100), camera)) out.push(t);
      }

      // Checkered start line across sample 0
      if (i === track.spawnIdx) {
        const cells = 8;
        for (let cRow = 0; cRow < 2; cRow++) {
          for (let cCol = 0; cCol < cells; cCol++) {
            const l0 = -a.hw + (2 * a.hw * cCol) / cells;
            const l1 = -a.hw + (2 * a.hw * (cCol + 1)) / cells;
            const f0 = 0.15 + cRow * 0.55, f1 = 0.15 + (cRow + 1) * 0.55;
            const col = ((cCol + cRow) & 1) ? CHECK_B : CHECK_A;
            const cpts = [
              lerpEdge(a, b, f0 / 2, l0), lerpEdge(a, b, f0 / 2, l1),
              lerpEdge(a, b, f1 / 2, l1), lerpEdge(a, b, f1 / 2, l0),
            ];
            for (const t of buildFace(cpts, col, camera)) { t.avgZ -= 0.05; out.push(t); }
          }
        }
      }
    }

    // ---- Rumble strips + walls (only where road exists) -----------------------
    if (!a.gap && !b.gap) {
      if (d2 < RUMBLE_DIST_SQ) {
        const col = (i & 1) ? RUMBLE_RED : RUMBLE_WHT;
        for (const side of [-1, 1]) {
          const rpts = [
            edgePt(a, side, a.hw),            edgePt(a, side, a.hw + RUMBLE_W),
            edgePt(b, side, b.hw + RUMBLE_W), edgePt(b, side, b.hw),
          ];
          for (const t of buildFace(rpts, col, camera)) out.push(t);
        }
      }
      // Walls: vertical quads at the rumble outer edge
      const wallCol = (i & 3) < 2 ? WALL_A : WALL_B;
      for (const side of [-1, 1]) {
        const w0 = edgePt(a, side, a.hw + RUMBLE_W);
        const w1 = edgePt(b, side, b.hw + RUMBLE_W);
        const wpts = [
          { x: w0.x, y: w0.y, z: w0.z },
          { x: w1.x, y: w1.y, z: w1.z },
          { x: w1.x, y: w1.y + WALL_H, z: w1.z },
          { x: w0.x, y: w0.y + WALL_H, z: w0.z },
        ];
        for (const t of buildFace(wpts, side > 0 ? wallCol : shadeFace(wallCol, 0.8), camera)) out.push(t);
      }
    }

    // ---- Grass aprons ----------------------------------------------------------
    if (!a.gap && !b.gap && d2 < GRASS_DIST_SQ && tex.grass) {
      for (const side of [-1, 1]) {
        const g0 = edgePt(a, side, a.hw + RUMBLE_W);
        const g1 = edgePt(a, side, a.hw + GRASS_W);
        const g2 = edgePt(b, side, b.hw + GRASS_W);
        const g3 = edgePt(b, side, b.hw + RUMBLE_W);
        const U = 0.07;
        const gpts = [
          { x: g0.x, y: g0.y - 0.15, z: g0.z, u: g0.x * U, v: g0.z * U },
          { x: g1.x, y: g1.y - 0.35, z: g1.z, u: g1.x * U, v: g1.z * U },
          { x: g2.x, y: g2.y - 0.35, z: g2.z, u: g2.x * U, v: g2.z * U },
          { x: g3.x, y: g3.y - 0.15, z: g3.z, u: g3.x * U, v: g3.z * U },
        ];
        for (const t of buildTexturedFace(gpts, GRASS_TINT, tex.grass, camera)) {
          t.avgZ += 0.15; // grass sorts behind the road/rumble at shared edges
          out.push(t);
        }
      }
    }

    // ---- Gap end caps (vertical faces where the road tears off) ----------------
    const prev = s[(i - 1 + n) % n];
    const capAt = (edge) => {
      const cL = { x: edge.x - edge.px * edge.hw, z: edge.z - edge.pz * edge.hw };
      const cR = { x: edge.x + edge.px * edge.hw, z: edge.z + edge.pz * edge.hw };
      const cpts = [
        { x: cL.x, y: edge.y, z: cL.z },
        { x: cR.x, y: edge.y, z: cR.z },
        { x: cR.x, y: edge.y - 2.6, z: cR.z },
        { x: cL.x, y: edge.y - 2.6, z: cL.z },
      ];
      for (const t of buildFace(cpts, CAP_COLOR, camera)) out.push(t);
    };
    if (a.gap && !prev.gap) capAt(a);        // takeoff face
    if (!a.gap && prev.gap) capAt(a);        // landing face
  }

  return out;
}

function edgePt(sample, side, lat) {
  return {
    x: sample.x + sample.px * side * lat,
    y: sample.y,
    z: sample.z + sample.pz * side * lat,
  };
}

// Point at fractional distance f along segment a→b, lateral offset l
function lerpEdge(a, b, f, l) {
  return {
    x: a.x + (b.x - a.x) * f + a.px * l,
    y: a.y + (b.y - a.y) * f + 0.02,
    z: a.z + (b.z - a.z) * f + a.pz * l,
  };
}

/**
 * racer/trackrender.js — Builds render triangles for the track each frame.
 *
 * Consumes the SAME sample array physics uses, so the rendered road exactly
 * matches the collision boundary. Everything returns engine tri objects
 * ({verts, color, avgZ, texture?}) for the shared sort+draw pass.
 */
import { buildPoly, rgba, shadeFace } from "../engine/renderer.js";
import { sinDeg, cosDeg } from "../engine/luts.js";
import { RUMBLE_W } from "./track.js";

const CULL_DIST      = 165;   // max sample distance from camera
const CULL_DIST_SQ   = CULL_DIST * CULL_DIST;
const BEHIND_MARGIN  = 16;    // keep samples slightly behind the camera
const RUMBLE_DIST_SQ = 120 * 120;
const WALL_H         = 1.7;

const ROAD_TINT   = rgba(230, 230, 232);
const GRASS_TINT  = rgba(215, 235, 210);
const RUMBLE_RED  = rgba(205, 45, 45);
const RUMBLE_WHT  = rgba(232, 232, 232);
const WALL_A      = rgba(125, 125, 138);
const WALL_B      = rgba(105, 105, 118);
const CAP_COLOR   = rgba(70, 55, 45);
const GROUND_COL  = rgba(52, 108, 50);
const BANK_GROUND = rgba(97, 77, 57);   // dirt under the bank/rumble band
const CHECK_A     = rgba(240, 240, 240);
const CHECK_B     = rgba(25, 25, 28);
// Sloped edge bank — spline-editor parity: darker lip from BEVEL_IN×hw to the
// track edge (hw), banked via edgePt (same as editor edgeCorner). The outer
// edge is lifted BEVEL_LIFT along the deck normal so the bank is a real sloped
// face — never coplanar with the road (a flat strip z-fought it). The rumble
// strip sits between the bank and the wall. Every spline face here is emitted
// as ONE quad unit (buildPoly) so the painter's pass sorts whole quads, not
// half-split triangles (tri splitting let the road show through at speed).
const BEVEL_IN   = 0.62;
const BEVEL_LIFT = 0.2;

export function buildTrackTris(track, tex, camera, frame) {
  const out = [];
  const s = track.samples;
  const n = track.count;

  // ---- Ground plane under everything (camera-centered) ----------------------
  // A flat textured plain at track.offroadY hides the sky gradient / void
  // below the horizon (and doubles as the off-road driving surface — physics
  // rides track.offroadY, see vehicle.js). Camera-centered grid (subdivided
  // so the grass texture maps with acceptable perspective); UVs are
  // world-anchored so the texture scrolls naturally as the car drives. Pushed
  // to the back via +500 sort bias.
  const gy = track.offroadY != null ? track.offroadY : track.minY - 0.4;
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
          for (const t of buildPoly(gpts, GRASS_TINT, tex.grass, camera)) {
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
      for (const t of buildPoly(gpts, GROUND_COL, null, camera)) {
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

    // Road stops at the start of the bank (BEVEL_IN×hw); the outer band from
    // there to the wall is bank + rumble with a ground plane underneath.
    const aL = edgePt(a, -1, a.hw * BEVEL_IN);
    const aR = edgePt(a,  1, a.hw * BEVEL_IN);
    const bL = edgePt(b, -1, b.hw * BEVEL_IN);
    const bR = edgePt(b,  1, b.hw * BEVEL_IN);

    // ---- Road surface --------------------------------------------------------
    if (!a.gap) {
      const va = a.dist * 0.22, vb = a.dist * 0.22 + a.segLen * 0.22;
      const pts = [
        { x: aL.x, y: aL.y, z: aL.z, u: 0,   v: va },
        { x: aR.x, y: aR.y, z: aR.z, u: 1.5, v: va },
        { x: bR.x, y: bR.y, z: bR.z, u: 1.5, v: vb },
        { x: bL.x, y: bL.y, z: bL.z, u: 0,   v: vb },
      ];
      if (tex.road) {
        for (const t of buildPoly(pts, ROAD_TINT, tex.road, camera)) out.push(t);
      } else {
        for (const t of buildPoly(pts, rgba(95, 95, 100), null, camera)) out.push(t);
      }

      // Checkered start line across sample 0
      if (i === track.spawnIdx) {
        const cells = 8;
        for (let cRow = 0; cRow < 2; cRow++) {
          for (let cCol = 0; cCol < cells; cCol++) {
            const l0 = -(a.hw * BEVEL_IN) + (2 * a.hw * BEVEL_IN * cCol) / cells;
            const l1 = -(a.hw * BEVEL_IN) + (2 * a.hw * BEVEL_IN * (cCol + 1)) / cells;
            const f0 = 0.15 + cRow * 0.55, f1 = 0.15 + (cRow + 1) * 0.55;
            const col = ((cCol + cRow) & 1) ? CHECK_B : CHECK_A;
            const cpts = [
              lerpEdge(a, b, f0 / 2, l0), lerpEdge(a, b, f0 / 2, l1),
              lerpEdge(a, b, f1 / 2, l1), lerpEdge(a, b, f1 / 2, l0),
            ];
            for (const t of buildPoly(cpts, col, null, camera)) { t.avgZ -= 0.05; out.push(t); }
          }
        }
      }
    }

    // ---- Bank + rumble + walls (only where road exists) -----------------------
    // The bank is the road's sloped edge lip from BEVEL_IN×hw to the track edge
    // (hw), lifted BEVEL_LIFT along the deck normal. The rumble strip sits
    // between the bank and the wall (hw..hw+RUMBLE_W), and the wall base is at
    // the outer edge of the rumble. Everything is emitted as ONE quad per face
    // (buildPoly) so the painter's pass sorts whole quads coherently instead of
    // independently-sorted triangles (which let the road show through at speed).
    if (!a.gap && !b.gap) {
      const bevelCol = shadeFace(ROAD_TINT, 0.55);
      const wallCol = (i & 3) < 2 ? WALL_A : WALL_B;
      for (const side of [-1, 1]) {
        const up0 = sampleUp(a), up1 = sampleUp(b);

        // Ground plane under the bank (and the rumble): a dirt strip from the
        // bank start to the wall base, dropped below the deck so the sloped
        // bank never shows sky/void underneath from low or side angles.
        const gn0 = edgePt(a, side, a.hw * BEVEL_IN);
        const gn1 = edgePt(b, side, b.hw * BEVEL_IN);
        const gx0 = edgePt(a, side, a.hw + RUMBLE_W);
        const gx1 = edgePt(b, side, b.hw + RUMBLE_W);
        const gdrop = 0.15; // matches the grass apron's inner edge drop
        const gpts = [
          { x: gn0.x, y: gn0.y - gdrop, z: gn0.z },
          { x: gx0.x, y: gx0.y - gdrop, z: gx0.z },
          { x: gx1.x, y: gx1.y - gdrop, z: gx1.z },
          { x: gn1.x, y: gn1.y - gdrop, z: gn1.z },
        ];
        for (const t of buildPoly(gpts, BANK_GROUND, null, camera)) out.push(t);

        // Sloped bank: deck at BEVEL_IN×hw, rising BEVEL_LIFT at the track edge.
        const bi0 = edgePt(a, side, a.hw * BEVEL_IN);
        const bi1 = edgePt(b, side, b.hw * BEVEL_IN);
        const bo0 = edgePt(a, side, a.hw);
        const bo1 = edgePt(b, side, b.hw);
        bo0.x += up0.x * BEVEL_LIFT; bo0.y += up0.y * BEVEL_LIFT; bo0.z += up0.z * BEVEL_LIFT;
        bo1.x += up1.x * BEVEL_LIFT; bo1.y += up1.y * BEVEL_LIFT; bo1.z += up1.z * BEVEL_LIFT;
        for (const t of buildPoly([bi0, bo0, bo1, bi1], bevelCol, null, camera)) out.push(t);

        // Rumble strip between the bank and the wall (deck height).
        if (d2 < RUMBLE_DIST_SQ) {
          const rcol = (i & 1) ? RUMBLE_RED : RUMBLE_WHT;
          const rpts = [
            edgePt(a, side, a.hw),
            edgePt(a, side, a.hw + RUMBLE_W),
            edgePt(b, side, b.hw + RUMBLE_W),
            edgePt(b, side, b.hw),
          ];
          for (const t of buildPoly(rpts, rcol, null, camera)) out.push(t);
        }

        // Wall: base at the outer edge of the rumble, top +WALL_H along the
        // banked surface normal so it hugs the cambered deck (world +Y on flat).
        // Only where BOTH samples have a solid wall — non-solid stretches are
        // drive-through gaps (tire-stack barriers stand in, see tirestacks.js).
        if (a.wallSolid !== false && b.wallSolid !== false) {
          const w0 = edgePt(a, side, a.hw + RUMBLE_W);
          const w1 = edgePt(b, side, b.hw + RUMBLE_W);
          const wpts = [
            { x: w0.x, y: w0.y, z: w0.z },
            { x: w1.x, y: w1.y, z: w1.z },
            { x: w1.x + up1.x * WALL_H, y: w1.y + up1.y * WALL_H, z: w1.z + up1.z * WALL_H },
            { x: w0.x + up0.x * WALL_H, y: w0.y + up0.y * WALL_H, z: w0.z + up0.z * WALL_H },
          ];
          for (const t of buildPoly(wpts, side > 0 ? wallCol : shadeFace(wallCol, 0.8), null, camera)) out.push(t);
        }
      }
    }

    // ---- Grass apron → off-road ramp -------------------------------------------
    // Slopes smoothly from the deck at the wall base (hw+RUMBLE_W) down to the
    // flat off-road floor plane (track.offroadY) over track.transW, so drivers
    // who leave the road can drive back up onto the deck instead of being stuck
    // below it. Physics rides this same surface (track.js groundHeightAt), so
    // the drawn ramp is exactly what the car drives on. Culled at the full
    // sample distance since the ramp can extend well past the road.
    if (!a.gap && !b.gap && d2 < CULL_DIST_SQ && tex.grass) {
      for (const side of [-1, 1]) {
        const g0 = edgePt(a, side, a.hw + RUMBLE_W);
        const g3 = edgePt(b, side, b.hw + RUMBLE_W);
        const g1 = edgePt(a, side, a.hw + RUMBLE_W + track.transW);
        const g2 = edgePt(b, side, b.hw + RUMBLE_W + track.transW);
        const U = 0.07;
        const gpts = [
          { x: g0.x, y: g0.y - 0.02, z: g0.z, u: g0.x * U, v: g0.z * U },
          { x: g1.x, y: track.offroadY + 0.02, z: g1.z, u: g1.x * U, v: g1.z * U },
          { x: g2.x, y: track.offroadY + 0.02, z: g2.z, u: g2.x * U, v: g2.z * U },
          { x: g3.x, y: g3.y - 0.02, z: g3.z, u: g3.x * U, v: g3.z * U },
        ];
        for (const t of buildPoly(gpts, GRASS_TINT, tex.grass, camera)) {
          t.avgZ += 0.15; // grass sorts behind the road/rumble at shared edges
          out.push(t);
        }
      }
    }

    // ---- Gap end caps (vertical faces where the road tears off) ----------------
    const prev = s[(i - 1 + n) % n];
    const capAt = (edge) => {
      const cL = edgePt(edge, -1, edge.hw);
      const cR = edgePt(edge,  1, edge.hw);
      const cpts = [
        { x: cL.x, y: cL.y, z: cL.z },
        { x: cR.x, y: cR.y, z: cR.z },
        { x: cR.x, y: cR.y - 2.6, z: cR.z },
        { x: cL.x, y: cL.y - 2.6, z: cL.z },
      ];
      for (const t of buildPoly(cpts, CAP_COLOR, null, camera)) out.push(t);
    };
    if (a.gap && !prev.gap) capAt(a);        // takeoff face
    if (!a.gap && prev.gap) capAt(a);        // landing face
  }

  return out;
}

/** Banked lateral edge — matches spline-editor ribbonCorners / edgeCorner. */
export function edgePt(sample, side, lat) {
  const b = (sample.bank || 0) * Math.PI / 180;
  const cb = Math.cos(b), sb = Math.sin(b);
  return {
    x: sample.x + sample.px * cb * side * lat,
    y: sample.y + sb * side * lat,
    z: sample.z + sample.pz * cb * side * lat,
  };
}

/**
 * Unit vector perpendicular to the banked deck at a sample ("up"). With
 * forward f=(fx,0,fz) and banked lateral l=(px·cb, sb, pz·cb), the outward
 * surface normal is f×l → (fz·sb, cb, −fx·sb). Bank=0 gives (0,1,0).
 */
export function sampleUp(sample) {
  const b = (sample.bank || 0) * Math.PI / 180;
  const cb = Math.cos(b), sb = Math.sin(b);
  return { x: sample.fz * sb, y: cb, z: -sample.fx * sb };
}

// Point at fractional distance f along segment a→b, lateral offset l (bank-aware)
function lerpEdge(a, b, f, l) {
  const p = {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    z: a.z + (b.z - a.z) * f,
    px: a.px, pz: a.pz,
    bank: (a.bank || 0) + ((b.bank || 0) - (a.bank || 0)) * f,
  };
  const e = edgePt(p, Math.sign(l) || 1, Math.abs(l));
  e.y += 0.02;
  return e;
}

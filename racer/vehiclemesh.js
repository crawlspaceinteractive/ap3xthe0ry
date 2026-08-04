/**
 * racer/vehiclemesh.js — Vehicle model renderer with full yaw+pitch+roll.
 *
 * The engine's buildMeshTris only supports yaw, so the racer transforms the
 * GLB itself: prepareVehicleMesh() pre-bakes a centered, scaled triangle
 * list once at load; buildVehicleTris() rotates (roll → pitch → yaw),
 * translates, flat-lights and projects per frame.
 *
 * If the GLB fails to load, prepareVehicleMesh(null) returns a procedural
 * kart built from boxes, rendered through the exact same path.
 */
import { project, rgba } from "../engine/renderer.js";
import { tunable } from "../engine/tunable.js";

const S = (min, max, step) => ({ min, max, step, restart: false });

// Model fit tunables — applied LIVE every frame in buildVehicleTris:
// offset in car-local space (X right, Y up, Z nose), rotation offsets in
// degrees (yawOffset fixes a sideways-facing GLB: try 90/180/270), and a
// scale multiplier on top of the auto-fit.
const MODEL = tunable("carModel", {
  offsetX:     0.0,
  offsetY:     0.0,
  offsetZ:     0.0,
  yawOffset:   180,
  pitchOffset: 0,
  rollOffset:  0,
  scale:       1.0,
}, {
  offsetX:     S(-2.0, 2.0, 0.01),
  offsetY:     S(-2.0, 2.0, 0.01),
  offsetZ:     S(-2.0, 2.0, 0.01),
  yawOffset:   S(-180, 180, 1),
  pitchOffset: S(-180, 180, 1),
  rollOffset:  S(-180, 180, 1),
  scale:       S(0.2, 4.0, 0.02),
}, { label: "Car Model" });

const TARGET_LEN = 2.6;   // world-unit length the model is scaled to
const LIGHT = normalize(0.45, 0.80, 0.30);

function normalize(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

// ---- Preparation --------------------------------------------------------------
// Returns { tris } where each tri is
// { ax,ay,az, bx,by,bz, cx,cy,cz, color, texture, uas,vas, ubs,vbs, ucs,vcs }
export function prepareVehicleMesh(meshData) {
  if (!meshData || !meshData.vertices || !meshData.indices) {
    const prep = buildFallbackKart();
    prep.headlights = findHeadlightPoints(prep.tris);
    return prep;
  }
  const V = meshData.vertices;
  const I = meshData.indices;
  const C = meshData.colors;
  const UV = meshData.uvs;

  // Bounding box → center XZ, rest on Y=0, scale to TARGET_LEN
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < V.length; i += 3) {
    if (V[i] < minX) minX = V[i];
    if (V[i] > maxX) maxX = V[i];
    if (V[i + 1] < minY) minY = V[i + 1];
    if (V[i + 1] > maxY) maxY = V[i + 1];
    if (V[i + 2] < minZ) minZ = V[i + 2];
    if (V[i + 2] > maxZ) maxZ = V[i + 2];
  }
  const cx = (minX + maxX) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const extent = Math.max(maxX - minX, maxZ - minZ) || 1;
  const s = TARGET_LEN / extent;

  const tris = [];
  const triCount = (I.length / 3) | 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = I[t * 3], i1 = I[t * 3 + 1], i2 = I[t * 3 + 2];
    const tex = (meshData.triTextures && meshData.triTextures[t]) || meshData.texture || null;

    // Per-tri base color: average of vertex colors (white when textured)
    let color;
    if (tex) {
      color = rgba(235, 235, 235);
    } else if (C) {
      const r = ((C[i0 * 4] + C[i1 * 4] + C[i2 * 4]) / 3) * 255;
      const g = ((C[i0 * 4 + 1] + C[i1 * 4 + 1] + C[i2 * 4 + 1]) / 3) * 255;
      const b = ((C[i0 * 4 + 2] + C[i1 * 4 + 2] + C[i2 * 4 + 2]) / 3) * 255;
      color = rgba(r | 0, g | 0, b | 0);
    } else {
      color = rgba(200, 60, 70);
    }

    tris.push({
      ax: (V[i0 * 3] - cx) * s, ay: (V[i0 * 3 + 1] - minY) * s, az: (V[i0 * 3 + 2] - cz) * s,
      bx: (V[i1 * 3] - cx) * s, by: (V[i1 * 3 + 1] - minY) * s, bz: (V[i1 * 3 + 2] - cz) * s,
      cx: (V[i2 * 3] - cx) * s, cy: (V[i2 * 3 + 1] - minY) * s, cz: (V[i2 * 3 + 2] - cz) * s,
      color,
      texture: tex,
      ua: UV ? UV[i0 * 2] : 0, va: UV ? UV[i0 * 2 + 1] : 0,
      ub: UV ? UV[i1 * 2] : 0, vb: UV ? UV[i1 * 2 + 1] : 0,
      uc: UV ? UV[i2 * 2] : 0, vc: UV ? UV[i2 * 2 + 1] : 0,
    });
  }
  return { tris, fallback: false, headlights: findHeadlightPoints(tris) };
}

// ---- Headlight anchors --------------------------------------------------------
// Extracts the top front-corner points of a prepared mesh (car-local space).
// Both z-extremes are captured: which one is the NOSE depends on the live
// yawOffset (a 180°-flipped GLB has its nose at local -Z), so getHeadlightRig()
// picks at render time and re-attaches if the slider changes.
function findHeadlightPoints(tris) {
  let minZ = Infinity, maxZ = -Infinity;
  for (const t of tris) {
    if (t.az < minZ) minZ = t.az;
    if (t.bz < minZ) minZ = t.bz;
    if (t.cz < minZ) minZ = t.cz;
    if (t.az > maxZ) maxZ = t.az;
    if (t.bz > maxZ) maxZ = t.bz;
    if (t.cz > maxZ) maxZ = t.cz;
  }
  const band = (maxZ - minZ) * 0.12 || 1;
  const collect = (zEdge) => {
    const verts = [];
    for (const t of tris) {
      for (const v of [[t.ax, t.ay, t.az], [t.bx, t.by, t.bz], [t.cx, t.cy, t.cz]]) {
        if (Math.abs(v[2] - zEdge) <= band) verts.push(v);
      }
    }
    if (!verts.length) return null;
    let minX = Infinity, maxX = -Infinity;
    for (const v of verts) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
    }
    const width = (maxX - minX) || 1;
    let yL = -Infinity, yR = -Infinity;
    for (const v of verts) {
      if (Math.abs(v[0] - minX) <= width * 0.25 && v[1] > yL) yL = v[1];
      if (Math.abs(v[0] - maxX) <= width * 0.25 && v[1] > yR) yR = v[1];
    }
    return {
      left:  { x: minX, y: yL === -Infinity ? 0 : yL, z: zEdge },
      right: { x: maxX, y: yR === -Infinity ? 0 : yR, z: zEdge },
    };
  };
  return { plus: collect(maxZ), minus: collect(minZ) };
}

// ---- Per-frame build -----------------------------------------------------------
const DEG = Math.PI / 180;

export function buildVehicleTris(prep, x, y, z, yawDeg, pitchDeg, rollDeg, camera) {
  const yaw = (yawDeg + MODEL.yawOffset) * DEG;
  const pit = (pitchDeg + MODEL.pitchOffset) * DEG;
  const rol = (rollDeg + MODEL.rollOffset) * DEG;
  const cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const cp = Math.cos(pit), sp = Math.sin(pit);
  const cr = Math.cos(rol), sr = Math.sin(rol);
  const sc = MODEL.scale;
  const ox = MODEL.offsetX, oy = MODEL.offsetY, oz = MODEL.offsetZ;

  const out = [];
  const w0 = {}, w1 = {}, w2 = {};

  const xf = (lx0, ly0, lz0, o) => {
    // scale + local-space offset (moves/rotates with the car)
    const lx = lx0 * sc + ox, ly = ly0 * sc + oy, lz = lz0 * sc + oz;
    // roll (around Z)
    const x1 = lx * cr + ly * sr;
    const y1 = -lx * sr + ly * cr;
    // pitch (around X, +nose up)
    const y2 = y1 * cp + lz * sp;
    const z2 = -y1 * sp + lz * cp;
    // yaw (around Y): forward local +Z → (sin yaw, cos yaw)
    const x3 = x1 * cyw + z2 * syw;
    const z3 = -x1 * syw + z2 * cyw;
    o.x = x + x3; o.y = y + y2; o.z = z + z3;
  };

  for (const t of prep.tris) {
    xf(t.ax, t.ay, t.az, w0);
    xf(t.bx, t.by, t.bz, w1);
    xf(t.cx, t.cy, t.cz, w2);

    const p0 = project(w0, camera);
    if (!p0.visible) continue;
    const p1 = project(w1, camera);
    if (!p1.visible) continue;
    const p2 = project(w2, camera);
    if (!p2.visible) continue;

    // Flat lighting from world-space face normal
    const e1x = w1.x - w0.x, e1y = w1.y - w0.y, e1z = w1.z - w0.z;
    const e2x = w2.x - w0.x, e2y = w2.y - w0.y, e2z = w2.z - w0.z;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const dot = Math.abs(nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z);
    const bright = 0.55 + 0.45 * dot;

    const c = t.color;
    const r = Math.min(255, ((c & 0xff) * bright)) | 0;
    const g = Math.min(255, (((c >>> 8) & 0xff) * bright)) | 0;
    const b = Math.min(255, (((c >>> 16) & 0xff) * bright)) | 0;
    const lit = (255 << 24) | (b << 16) | (g << 8) | r;

    if (t.texture) {
      p0.u = t.ua; p0.v = t.va;
      p1.u = t.ub; p1.v = t.vb;
      p2.u = t.uc; p2.v = t.vc;
    }
    out.push({
      verts: [{ ...p0 }, { ...p1 }, { ...p2 }],
      color: lit,
      avgZ: (p0.cz + p1.cz + p2.cz) * 0.3333333 - 0.02,
      texture: t.texture || undefined,
    });
  }
  return out;
}

// ---- Headlight rig (world-space anchors for FX) --------------------------------
// Mirrors the exact scale → roll → pitch → yaw transform from buildVehicleTris
// so glares/rays stay glued to the model corners, including MODEL.scale / offsets
// from the tuning sliders.
function carLocalToWorld(lx, ly, lz, yawDeg, pitchDeg, rollDeg, x, y, z) {
  const s = MODEL.scale;
  lx = lx * s + MODEL.offsetX;
  ly = ly * s + MODEL.offsetY;
  lz = lz * s + MODEL.offsetZ;
  const yaw = (yawDeg + MODEL.yawOffset) * DEG;
  const pit = (pitchDeg + MODEL.pitchOffset) * DEG;
  const rol = (rollDeg + MODEL.rollOffset) * DEG;
  const cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const cp = Math.cos(pit), sp = Math.sin(pit);
  const cr = Math.cos(rol), sr = Math.sin(rol);
  const x1 = lx * cr + ly * sr;
  const y1 = -lx * sr + ly * cr;
  const y2 = y1 * cp + lz * sp;
  const z2 = -y1 * sp + lz * cp;
  return {
    x: x + x1 * cyw + z2 * syw,
    y: y + y2,
    z: z - x1 * syw + z2 * cyw,
  };
}

// World-space direction of a car-local axis (rotations only, no scale/offset).
function carLocalDir(lx, ly, lz, yawDeg, pitchDeg, rollDeg) {
  const yaw = (yawDeg + MODEL.yawOffset) * DEG;
  const pit = (pitchDeg + MODEL.pitchOffset) * DEG;
  const rol = (rollDeg + MODEL.rollOffset) * DEG;
  const cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const cp = Math.cos(pit), sp = Math.sin(pit);
  const cr = Math.cos(rol), sr = Math.sin(rol);
  const x1 = lx * cr + ly * sr;
  const y1 = -lx * sr + ly * cr;
  const y2 = y1 * cp + lz * sp;
  const z2 = -y1 * sp + lz * cp;
  return { x: x1 * cyw + z2 * syw, z: -x1 * syw + z2 * cyw };
}

/**
 * World-space headlight anchors + model forward/scale for the FX pass.
 * @returns {null|{left:{x,y,z}, right:{x,y,z}, fwd:{x,z}, scale:number}}
 */
export function getHeadlightRig(prep, x, y, z, yawDeg, pitchDeg, rollDeg) {
  const hl = prep && prep.headlights;
  if (!hl) return null;
  // A 180°-flipped model renders its nose at the local -Z extreme.
  const nosePlus = Math.cos(MODEL.yawOffset * DEG) >= 0;
  const nose = nosePlus ? hl.plus : hl.minus;
  if (!nose) return null;
  const d = carLocalDir(0, 0, nosePlus ? 1 : -1, yawDeg, pitchDeg, rollDeg);
  const fl = Math.hypot(d.x, d.z) || 1;
  return {
    left:  carLocalToWorld(nose.left.x, nose.left.y, nose.left.z, yawDeg, pitchDeg, rollDeg, x, y, z),
    right: carLocalToWorld(nose.right.x, nose.right.y, nose.right.z, yawDeg, pitchDeg, rollDeg, x, y, z),
    fwd: { x: d.x / fl, z: d.z / fl },
    scale: MODEL.scale,
  };
}

// ---- Procedural fallback kart ---------------------------------------------------
function buildFallbackKart() {
  const tris = [];
  const BODY = rgba(210, 55, 60);
  const CAB  = rgba(235, 225, 210);
  const DARK = rgba(35, 35, 40);

  // box centered at (cx, cy, cz) with half-sizes
  const addBox = (bx, by, bz, hx, hy, hz, color) => {
    const c = [
      [bx - hx, by + hy, bz - hz], [bx + hx, by + hy, bz - hz],
      [bx + hx, by + hy, bz + hz], [bx - hx, by + hy, bz + hz],
      [bx - hx, by - hy, bz - hz], [bx + hx, by - hy, bz - hz],
      [bx + hx, by - hy, bz + hz], [bx - hx, by - hy, bz + hz],
    ];
    const quads = [
      [0, 1, 2, 3], [4, 5, 6, 7], [4, 5, 1, 0],
      [7, 6, 2, 3], [5, 6, 2, 1], [4, 7, 3, 0],
    ];
    for (const q of quads) {
      const [a, b, d, e] = q.map(i => c[i]);
      tris.push(rawTri(a, b, d, color), rawTri(a, d, e, color));
    }
  };
  const rawTri = (a, b, c, color) => ({
    ax: a[0], ay: a[1], az: a[2],
    bx: b[0], by: b[1], bz: b[2],
    cx: c[0], cy: c[1], cz: c[2],
    color, texture: null,
    ua: 0, va: 0, ub: 0, vb: 0, uc: 0, vc: 0,
  });

  addBox(0, 0.42, 0.0, 0.62, 0.24, 1.30, BODY);          // body (nose +Z)
  addBox(0, 0.80, -0.25, 0.42, 0.16, 0.55, CAB);          // cabin
  addBox(-0.62, 0.28, 0.85, 0.14, 0.28, 0.28, DARK);      // wheels
  addBox( 0.62, 0.28, 0.85, 0.14, 0.28, 0.28, DARK);
  addBox(-0.62, 0.28, -0.85, 0.14, 0.28, 0.28, DARK);
  addBox( 0.62, 0.28, -0.85, 0.14, 0.28, 0.28, DARK);
  addBox(0, 0.72, -1.05, 0.55, 0.05, 0.16, DARK);         // spoiler
  return { tris, fallback: true };
}

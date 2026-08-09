/**
 * racer/tirestacks.js — Destructible tire-stack barriers on open wall runs.
 *
 * Track walls are randomly solid/non-solid (see track.js). Where the wall is
 * absent, tire stacks stand as soft barriers just outside the road edge so
 * the gap still reads as "off limits" until you commit. Light physics: the
 * car is never blocked — it drives through and the stacks get knocked aside,
 * pop up, slide, lean, and settle back to the ground (off-road is the real
 * punishment, via vehicle.js).
 *
 * Placement is deterministic (seeded by arc distance), so a given track
 * always builds the same stacks. Each stack is a column of short cylinders
 * emitted as whole quad units (buildPoly) so the painter's pass sorts them
 * coherently with the rest of the spline meshes.
 */
import { buildPoly, rgba, shadeFace } from "../engine/renderer.js";
import { mulberry32 } from "./track.js";
import { edgePt } from "./trackrender.js";

const CULL_DIST_SQ = 165 * 165;
const RUMBLE_W = 0.9;      // wall base sits at hw+RUMBLE_W (trackrender.js)
const TIRE_R = 0.52;
const TIRE_H = 0.22;
const TIRE_STEP = 0.25;
const TIRES = 3;
const STACK_H = TIRE_STEP * (TIRES - 1) + TIRE_H; // total stack height
const SIDES = 7;           // polygon sides per tire (odd → no axis-aligned look)
const GRAVITY = 0.012;
const FRICTION = 0.9;      // per-frame slide damping once settled
const REST_EPS = 0.004;    // speed under which a knocked stack stops
const CAR_COLLIDE_R = 1.2; // knock sphere around the car center
const KNOCK_T = 12;        // frames between impulses while overlapping

const TIRE_DARK = rgba(30, 29, 34);   // sidewalls
const TIRE_FACE = rgba(52, 50, 58);   // tread faces (top/bottom)
const TIRE_BOT  = shadeFace(TIRE_FACE, 0.72);

// ---- One tire = a short cylinder: side quads + top/bottom n-gon caps --------
function pushTire(cx, cy, cz, r, h, camera, tris) {
  const ring = [];
  for (let i = 0; i < SIDES; i++) {
    const a = (i / SIDES) * Math.PI * 2;
    ring.push({ x: cx + Math.cos(a) * r, y: cy, z: cz + Math.sin(a) * r });
  }
  const top = ring.map((p) => ({ x: p.x, y: cy + h, z: p.z }));
  for (let i = 0; i < SIDES; i++) {
    const j = (i + 1) % SIDES;
    const sideCol = shadeFace(TIRE_DARK, (i & 1) ? 0.62 : 0.5);
    for (const t of buildPoly([ring[i], ring[j], top[j], top[i]], sideCol, null, camera)) tris.push(t);
  }
  for (const t of buildPoly(ring, TIRE_BOT, null, camera)) tris.push(t);
  for (const t of buildPoly(top, TIRE_FACE, null, camera)) tris.push(t);
}

/**
 * Place tire stacks on every non-solid wall run (per side of the road).
 * Deterministic per track. Returns an array of stack objects.
 */
export function createTireStacks(track) {
  const s = track.samples;
  const n = track.count;
  const stacks = [];
  let i = 0;
  while (i < n) {
    const a = s[i];
    if (a.wallSolid !== false || a.ramp || a.gap) { i++; continue; }
    // Collect the whole non-solid run
    let j = i;
    while (j < n && s[j].wallSolid === false && !s[j].ramp && !s[j].gap) j++;
    if (j - i >= 2) {
      const mid = s[i + ((j - i - 1) >> 1)];
      const rng = mulberry32(((mid.dist * 2654435761) >>> 0) || 1);
      for (const side of [-1, 1]) {
        const base = edgePt(mid, side, mid.hw + RUMBLE_W);
        const jx = (rng() - 0.5) * 0.8;          // lateral jitter along the wall line
        const px = mid.px * side, pz = mid.pz * side;
        stacks.push({
          x: base.x + px * jx,
          y: base.y,
          z: base.z + pz * jx,
          baseY: base.y,          // rests at the wall base (deck height)
          restY: track.offroadY,  // can fall to the off-road plain if pushed off
          r: TIRE_R,
          vx: 0, vy: 0, vz: 0,
          moving: false,
          lean: 0, leanYaw: 0,    // tumble lean (shear), direction of lean
          knockT: 0,
        });
      }
    }
    i = j;
  }
  return stacks;
}

// ---- Per-frame physics: car knock + integrate + settle ----------------------
export function stepTireStacks(stacks, v) {
  if (!stacks || !stacks.length) return;
  const speed = Math.hypot(v.vx, v.vz);
  for (const st of stacks) {
    // Car collision — knock the stack away (the car is never blocked).
    if (st.knockT > 0) st.knockT--;
    const ddx = st.x - v.x, ddz = st.z - v.z;
    const hd2 = ddx * ddx + ddz * ddz;
    const collideR = st.r + CAR_COLLIDE_R;
    const vertOk = Math.abs(v.y - st.y) < STACK_H + 1.0;
    if (st.knockT <= 0 && hd2 < collideR * collideR && vertOk) {
      const hd = Math.sqrt(hd2) || 1e-5;
      const nx = ddx / hd, nz = ddz / hd;
      const imp = 0.05 + speed * 0.05;
      st.vx += nx * imp;
      st.vz += nz * imp;
      st.vy += 0.04;                            // pops up off the deck
      st.moving = true;
      st.knockT = KNOCK_T;
      st.lean = Math.min(0.5, st.lean + 0.14);
      st.leanYaw = Math.atan2(nz, nx) + (Math.random() - 0.5) * 1.2;
    }

    // Integrate (gravity + slide). Rest on the deck; fall to the plain if the
    // stack gets knocked past the road edge.
    st.x += st.vx;
    st.z += st.vz;
    st.y += st.vy;
    st.vy -= GRAVITY;
    if (st.y < st.restY) { st.y = st.restY; if (st.vy < 0) st.vy = 0; }

    if (st.moving) {
      if (st.y <= st.baseY + 0.01) { st.vx *= FRICTION; st.vz *= FRICTION; }
      st.lean *= 0.96;
      if (Math.abs(st.vx) < REST_EPS && Math.abs(st.vz) < REST_EPS) {
        st.vx = st.vy = st.vz = 0;
        st.moving = false;
        st.lean = 0;
      }
    }
  }
}

// ---- Render: push all visible stack tris into the shared painter array ------
export function buildTireStackTris(stacks, camera, tris) {
  if (!stacks || !stacks.length) return;
  for (const st of stacks) {
    const dx = st.x - camera.x, dz = st.z - camera.z;
    if (dx * dx + dz * dz > CULL_DIST_SQ) continue;

    // Lean shear: the stack bends over its tumble axis, growing with height.
    const lx = Math.cos(st.leanYaw) * st.lean;
    const lz = Math.sin(st.leanYaw) * st.lean;
    const last = TIRES - 1;
    for (let k = 0; k < TIRES; k++) {
      const t = last > 0 ? k / last : 0;
      pushTire(
        st.x + lx * t,
        st.y + k * TIRE_STEP,
        st.z + lz * t,
        st.r, TIRE_H, camera, tris
      );
    }
  }
}

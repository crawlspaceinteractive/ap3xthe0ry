/**
 * racer/geospawner.js — Runtime geo placement: inset islands/mountains/rings
 * (GLB, biome-shaded) + procedural buildings that sit flat on the off-road
 * floor.
 *
 * Placement
 * ─────────
 * Candidates are sampled along the track band (every SAMPLE_STEP samples),
 * offset laterally past the grass apron onto the flat off-road floor
 * (lat ≥ hw + RUMBLE_W + transW). Rejection sampling enforces a minimum
 * separation and keeps every footprint out of the drivable corridor
 * (|lat| ≥ hw + RUMBLE_W + margin), so geo never blocks the road or a jump.
 *
 * Anchoring
 * ─────────
 * GLB instances follow the "midpoint inset" rule: the model pivot sits on the
 * terrain surface at its center, so the top half pokes through and the bottom
 * half is buried. A per-kind sink knob (1 = midpoint inset, 0 = base on
 * surface) tunes how much is buried. "Big" terrain (half-extent ≥ 16u, e.g.
 * mountains / land rings / scaled-up islands) instead becomes a sky island:
 * lifted 64u above the terrain and scooted further off the road. Buildings
 * rest on the LOWEST groundHeightAt under their rotated footprint (4 corners
 * + 4 edge midpoints) — they sit flat, and corners nearer the road bury into
 * the apron slope.
 *
 * Rendering: GLB instances are precached once at placement (scale + yaw +
 * biome colors baked), then blitted per frame via buildMeshTrisFromCache.
 * Buildings rebuild their primitives per frame (cheap — a few blocks each).
 *
 * Collision: buildings are circle-vs-AABB push-out (boxes); GLB terrain is
 * circle-vs-mesh-silhouette push-out against the actual precached triangles,
 * so sunk models only block where they're visible. Consumed by vehicle.js
 * (see geo.spawner resolve).
 */
import { mulberry32, queryTrack, groundHeightAt, RUMBLE_W } from "./track.js";
import { precacheIslandColors, buildMeshTrisFromCache } from "../engine/geometry.js";
import { buildTrapezoid, rgba } from "../engine/renderer.js";
import { getGeoModelsByKind, geoKindDefault } from "./geoassets.js";

const CULL_DIST    = 165;
const CULL_DIST_SQ = CULL_DIST * CULL_DIST;
const BEHIND_MARGIN = 16;
const SAMPLE_STEP  = 4;          // samples between placement candidates
const MIN_SEP      = 14;         // min center distance between instances
const DECK_MARGIN  = 1.5;        // footprint must clear the deck by this much
const MAX_TRIES    = 2400;       // rejection cap per kind (skip-if-no-spot)

// "Big" terrain (half-extent >= BIG_ISLAND_HALF — e.g. mountains, land rings
// and islands scaled up past the default) reads as sky islands: scooted
// further off the road and lifted high above the terrain, so cars drive past
// under them instead of bouncing off a grounded hunk. Non-big islands stay
// grounded at terrain level as before.
const BIG_ISLAND_HALF        = 32;   // world-unit half-extent threshold
const BIG_ISLAND_LIFT        = 32;   // world units a big island floats above the terrain
const BIG_ISLAND_OFFSET_MIN  = 32;   // extra lateral offset floor (normal islands: 2)
const BIG_ISLAND_OFFSET_SPREAD = 24; // extra offset jitter range (normal islands: 12)

// Default profile shape — used when a level has no authored `geo` profile.
// Every field is optional; counts fall back to density-driven estimates.
export const DEFAULT_GEO_PROFILE = {
  seed: 6661337,
  density: 100,                  // 0..100 → scales all default counts
  island:   null,               // { count?, scale?, sink? } or null
  mountain: null,
  landRing: null,
  building: null,               // { count?, scale?, sink? } (sink ignored)
};

const DEFAULT_BUILDING_WALL = rgba(180, 168, 152);
const DEFAULT_BUILDING_ROOF = rgba(120, 96, 78);

/** Rotated footprint probe points (4 corners + 4 edge midpoints). */
function footprintPoints(x, z, hw, hd, yaw) {
  const r = (yaw * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const pts = [];
  const add = (lx, lz) => pts.push({ x: x + lx * c - lz * s, z: z + lx * s + lz * c });
  add(-hw, -hd); add(hw, -hd); add(hw, hd); add(-hw, hd);
  add(0, -hd); add(hw, 0); add(0, hd); add(-hw, 0);
  return pts;
}

/** Yaw-rotated AABB half-extents (circumscribing box, always ≥ footprint). */
function rotatedHalfExtents(hw, hd, yaw) {
  const r = (yaw * Math.PI) / 180;
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  return { hw: hw * c + hd * s, hd: hw * s + hd * c };
}

export class GeoSpawner {
  constructor() {
    this.instances = [];
    this._ready = false;
    this._profile = null;
  }

  reset() {
    this.instances = [];
    this._ready = false;
    this._profile = null;
  }

  /**
   * Place geo for a track. `profile` is the level's optional geo config
   * (merged over DEFAULT_GEO_PROFILE); `biome` is the resolved biome entry
   * (getBiome()) used for island shading + building paint. GLB kinds are
   * skipped until loadGeoAssets() has resolved.
   */
  place(track, profile, biome) {
    if (!track || !track.samples || track.count < 3) return;
    const prof = mergeProfile(profile);
    this._profile = prof;
    this._ready = true;
    this.instances = [];

    const rng = mulberry32(prof.seed | 0);
    const s = track.samples;
    const n = track.count;
    const total = track.totalLen || 1;

    const pal = biome || {};
    const wallCol = pal.side || DEFAULT_BUILDING_WALL;
    const roofCol = pal.top || DEFAULT_BUILDING_ROOF;

    this._placeGLBs("island", s, n, rng, track, total, prof, prof.island, pal);
    this._placeGLBs("mountain", s, n, rng, track, total, prof, prof.mountain, pal);
    this._placeGLBs("landRing", s, n, rng, track, total, prof, prof.landRing, pal);
    this._placeBuildings(s, n, rng, track, total, prof, prof.building, wallCol, roofCol);

    console.log(`[geospawner] placed ${this.instances.length} instances` +
      (this.instances.length ? ` (${this._byKindSummary()})` : ""));
  }

  _byKindSummary() {
    const m = {};
    for (const i of this.instances) m[i.kind] = (m[i.kind] || 0) + 1;
    return Object.entries(m).map(([k, v]) => `${k}:${v}`).join(" ");
  }

  // ---- GLB kinds (island / mountain / landRing) -----------------------------
  _placeGLBs(kind, s, n, rng, track, total, prof, opt, pal) {
    if (opt === false) return;
    const models = getGeoModelsByKind(kind);
    if (!models.length) return;
    const def = geoKindDefault(kind);
    const count = resolveCount(opt, total, kind, prof.density);
    if (count <= 0) return;
    const scaleMul = opt && opt.scale != null ? opt.scale : 1;
    const sink = opt && opt.sink != null ? opt.sink : def.sink;

    const used = this.instances.map((i) => ({ x: i.x, z: i.z, r: Math.max(i.halfW, i.halfD) }));
    let placed = 0, guard = 0;
    while (placed < count && guard++ < MAX_TRIES) {
      const i = (rng() * n) | 0;
      const a = s[i];
      if (a.ramp || a.gap) continue;

      const model = models[(rng() * models.length) | 0];
      const hw = model.halfW * scaleMul;
      const hd = model.halfD * scaleMul;
      const big = Math.max(hw, hd) >= BIG_ISLAND_HALF;

      const side = rng() < 0.5 ? -1 : 1;
      const off = (a.hw + RUMBLE_W + track.transW) +
        (big ? BIG_ISLAND_OFFSET_MIN + rng() * BIG_ISLAND_OFFSET_SPREAD : 2 + rng() * 12);
      const lat = off * side;
      const x = a.x + a.px * lat;
      const z = a.z + a.pz * lat;

      const yaw = rng() * 360;

      if (!corridorClear(track, x, z, hw, hd, yaw)) continue;
      const rot = rotatedHalfExtents(hw, hd, yaw);
      const instR = Math.max(rot.hw, rot.hd);
      if (clashes(used, x, z, instR, MIN_SEP)) continue;

      const q = queryTrack(track, x, z);
      if (q.gap) continue;
      const baseY = groundHeightAt(track, q) + (big ? BIG_ISLAND_LIFT : 0);
      const topY = model.topY * scaleMul;
      const pivotY = baseY + (1 - sink) * topY;

      const cache = precacheIslandColors(model.meshData, model.scale * scaleMul, yaw, pal);

      used.push({ x, z, r: instR });
      this.instances.push({
        kind, x, z, baseY, pivotY, yaw,
        cache, halfW: rot.hw, halfD: rot.hd, topY,
      });
      placed++;
    }
  }

  // ---- Procedural buildings --------------------------------------------------
  // Boxes + tapered towers + cone roofs, stacked from a flat base on the
  // lowest point under the footprint. Footprints stay clear of the deck.
  _placeBuildings(s, n, rng, track, total, prof, opt, wallCol, roofCol) {
    if (opt === false) return;
    const count = resolveCount(opt, total, "building", prof.density);
    if (count <= 0) return;
    const scaleMul = opt && opt.scale != null ? opt.scale : 1;

    const used = this.instances.map((i) => ({ x: i.x, z: i.z, r: Math.max(i.halfW, i.halfD) }));
    let placed = 0, guard = 0;
    while (placed < count && guard++ < MAX_TRIES) {
      const i = (rng() * n) | 0;
      const a = s[i];
      if (a.ramp || a.gap) continue;

      const side = rng() < 0.5 ? -1 : 1;
      const off = (a.hw + RUMBLE_W + track.transW) + 1 + rng() * 8;
      const lat = off * side;
      const x = a.x + a.px * lat;
      const z = a.z + a.pz * lat;

      const hw = (2.2 + rng() * 3.4) * scaleMul;
      const hd = (2.2 + rng() * 3.4) * scaleMul;
      const yaw = rng() * 360;

      if (!corridorClear(track, x, z, hw, hd, yaw)) continue;
      const rot = rotatedHalfExtents(hw, hd, yaw);
      const instR = Math.max(rot.hw, rot.hd);
      if (clashes(used, x, z, instR, MIN_SEP * 0.6)) continue;

      // Lowest ground under the footprint → the building's flat base.
      let baseY = Infinity;
      for (const p of footprintPoints(x, z, hw, hd, yaw)) {
        const q = queryTrack(track, p.x, p.z);
        if (q.gap) continue;
        const gy = groundHeightAt(track, q);
        if (gy < baseY) baseY = gy;
      }
      if (baseY === Infinity) continue;

      used.push({ x, z, r: instR });
      this.instances.push(this._buildBuilding(x, z, baseY, yaw, hw, hd, rng, wallCol, roofCol));
      placed++;
    }
  }

  _buildBuilding(x, z, baseY, yaw, hw, hd, rng, wallCol, roofCol) {
    const style = rng() < 0.35 ? "tower" : rng() < 0.6 ? "shed" : "block";
    const blocks = [];
    let y = baseY;
    if (style === "tower") {
      const h = (5 + rng() * 5);
      blocks.push({ y, h, w: hw, d: hd, top: 0.5 });            // tapered lower block
      blocks.push({ y: y + h, h: 1.6, w: hw * 0.45, d: hd * 0.45, top: 0.45 }); // spire
    } else if (style === "shed") {
      const h = (2.2 + rng() * 2.2);
      blocks.push({ y, h, w: hw, d: hd, top: 0.35 });            // tapered shed roof
    } else {
      const h = (2.6 + rng() * 3.4);
      blocks.push({ y, h, w: hw, d: hd, top: 1 });               // flat-topped box
      if (rng() < 0.5) blocks.push({ y: y + h, h: 1.4, w: hw * 0.5, d: hd * 0.5, top: 1 });
    }
    // Visible top of the whole building (for collision span).
    let topY = 0;
    for (const b of blocks) topY = Math.max(topY, b.y + b.h - baseY);
    return { kind: "building", x, z, baseY, yaw, blocks, wallCol, roofCol, halfW: hw, halfD: hd, topY };
  }

  // ---- Render -----------------------------------------------------------------
  build(camera, frame, tris) {
    if (!this._ready || !this.instances.length) return;
    const camFx = Math.sin((camera.yaw * Math.PI) / 180);
    const camFz = Math.cos((camera.yaw * Math.PI) / 180);

    for (const inst of this.instances) {
      const dx = inst.x - camera.x;
      const dz = inst.z - camera.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > CULL_DIST_SQ) continue;
      if (dx * camFx + dz * camFz < -BEHIND_MARGIN) continue;

      if (inst.kind === "building") {
        for (const b of inst.blocks) {
          const cY = b.y + b.h * 0.5;
          for (const t of buildTrapezoid(inst.x, cY, inst.z, b.w, b.h * 0.5, b.d, b.top, inst.yaw, inst.roofCol, inst.wallCol, camera)) tris.push(t);
        }
      } else {
        const out = buildMeshTrisFromCache(inst.cache, inst.x, inst.pivotY, inst.z, camera);
        for (const t of out) tris.push(t);
      }
    }
  }

  // ---- Collision (solid walls) ------------------------------------------------
  /**
   * Solid-wall push-out for every instance whose vertical span [baseY,
   * baseY + topY] contains the query's height band. Mirrors the vehicle
   * wall-bounce style: returns the resolved push vector.
   *
   * Buildings are axis-aligned boxes → circle-vs-AABB. GLB terrain
   * (islands/mountains/land-rings) collide against their ACTUAL mesh
   * silhouette instead of the yaw-rotated circumscribing box: we find the
   * closest point on every vertical-band-overlapping projected triangle (XZ)
   * and push the circle out along (center − closest). A model sunk into the
   * ground therefore only blocks where you can SEE it — no more bouncing off
   * the invisible bounding box of the buried part.
   * @returns {{ px: number, pz: number, blocked: boolean }}
   */
  resolve(x, z, r, feetY) {
    let px = 0, pz = 0, blocked = false;
    for (const inst of this.instances) {
      if (feetY > inst.baseY + inst.topY || feetY + r < inst.baseY) continue;

      if (inst.kind === "building" || !inst.cache) {
        const cx = clamp(x, inst.x - inst.halfW, inst.x + inst.halfW);
        const cz = clamp(z, inst.z - inst.halfD, inst.z + inst.halfD);
        const dx = x - cx, dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          const d = Math.sqrt(d2) || 0.0001;
          const push = r - d;
          px += (dx / d) * push;
          pz += (dz / d) * push;
          blocked = true;
        }
        continue;
      }

      // Face collision: closest point on the mesh's XZ silhouette. The cache
      // holds scale+yaw-rotated local verts (no world translation), so world
      // verts are buf + (inst.x, inst.pivotY, inst.z) — the same transform
      // buildMeshTrisFromCache uses to render the instance.
      const { buf, triCount } = inst.cache;
      let bestD2 = Infinity, bestX = 0, bestZ = 0;
      for (let t = 0; t < triCount; t++) {
        const b = t * 9;
        const wy0 = buf[b+1] + inst.pivotY;
        const wy1 = buf[b+4] + inst.pivotY;
        const wy2 = buf[b+7] + inst.pivotY;
        const yLo = Math.min(wy0, wy1, wy2);
        const yHi = Math.max(wy0, wy1, wy2);
        if (yHi < feetY - r || yLo > feetY + r) continue;
        const d2 = closestOnTriD2(x, z,
          buf[b] + inst.x, buf[b+2] + inst.z,
          buf[b+3] + inst.x, buf[b+5] + inst.z,
          buf[b+6] + inst.x, buf[b+8] + inst.z,
          triClosest);
        if (d2 < bestD2) { bestD2 = d2; bestX = triClosest.x; bestZ = triClosest.z; }
      }

      const dCar2 = (x - inst.x) * (x - inst.x) + (z - inst.z) * (z - inst.z);
      const dHit2 = (bestX - inst.x) * (bestX - inst.x) + (bestZ - inst.z) * (bestZ - inst.z);
      const interior = dCar2 < dHit2;
      if (interior || bestD2 < r * r) {
        const d = Math.sqrt(bestD2) || 1e-6;
        let nx, nz;
        if (d < 1e-6) {
          // Center sits on the silhouette edge — push away from the island center.
          const dx = x - inst.x, dz = z - inst.z;
          const dl = Math.hypot(dx, dz) || 1;
          nx = dx / dl; nz = dz / dl;
        } else {
          nx = (x - bestX) / d; nz = (z - bestZ) / d;
        }
        if (interior) {
          // Interior: the car's center is closer to the island center than the
          // contact, i.e. inside the footprint (possibly tunneled deep, d > r).
          // (P−C) points INTO the mesh, so reverse it AND use the full exit
          // distance (d + r) to push the center just past the boundary — a
          // car whose center is > r from the surface would otherwise pass through.
          px -= nx * (d + r);
          pz -= nz * (d + r);
        } else {
          // Exterior shell overlap: center is outside the footprint but within
          // r of the surface. Push out by the overlap depth.
          const push = r - d;
          px += nx * push;
          pz += nz * push;
        }
        blocked = true;
      }
    }
    return { px, pz, blocked };
  }

  get count() { return this.instances.length; }
}

// ---- Profile / helpers -------------------------------------------------------

function mergeProfile(profile) {
  const base = {
    seed: DEFAULT_GEO_PROFILE.seed,
    density: DEFAULT_GEO_PROFILE.density,
    island: null, mountain: null, landRing: null, building: null,
  };
  if (!profile || typeof profile !== "object") return base;
  if (profile.seed != null) base.seed = profile.seed;
  if (profile.density != null) base.density = profile.density;
  for (const k of ["island", "mountain", "landRing", "building"]) {
    if (profile[k] != null) base[k] = profile[k];
  }
  return base;
}

function resolveCount(opt, total, kind, density) {
  if (opt && opt.count != null) return Math.max(0, opt.count | 0);
  const d = opt && opt.density != null ? opt.density : (density != null ? density : 40);
  const k = d / 50;
  switch (kind) {
    case "island":   return Math.max(1, Math.round((total / 220) * k));
    case "mountain": return Math.max(0, Math.round((total / 800) * k));
    case "landRing": return Math.max(0, Math.round((total / 1000) * k));
    default:         return Math.max(2, Math.round((total / 150) * k));
  }
}

function corridorClear(track, x, z, hw, hd, yaw) {
  for (const p of footprintPoints(x, z, hw, hd, yaw)) {
    const q = queryTrack(track, p.x, p.z);
    if (q.gap) return false;
    if (Math.abs(q.lat) < q.hw + RUMBLE_W + DECK_MARGIN) return false;
  }
  return true;
}

function clashes(used, x, z, r, sep) {
  for (const u of used) {
    const dx = x - u.x, dz = z - u.z;
    const rr = u.r + r + sep;
    if (dx * dx + dz * dz < rr * rr) return true;
  }
  return false;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Scratch for closestOnTriD2 (avoids per-triangle garbage).
const triClosest = { x: 0, z: 0 };

/**
 * Squared distance from (px,pz) to the closest point on triangle (a,b,q) in
 * the XZ plane (edge-clamped projection — a point inside the triangle keeps
 * the nearest edge as its contact). Stores the closest point in `out`.
 */
function closestOnTriD2(px, pz, ax, az, bx, bz, qx, qz, out) {
  let bx2 = ax, bz2 = az, bd2 = Infinity;
  const e = [
    [ax, az, bx, bz],
    [bx, bz, qx, qz],
    [qx, qz, ax, az],
  ];
  for (let k = 0; k < 3; k++) {
    const x0 = e[k][0], z0 = e[k][1], x1 = e[k][2], z1 = e[k][3];
    const dx = x1 - x0, dz = z1 - z0;
    const len2 = dx * dx + dz * dz || 1e-12;
    const t = clamp(((px - x0) * dx + (pz - z0) * dz) / len2, 0, 1);
    const cx = x0 + t * dx, cz = z0 + t * dz;
    const ddx = px - cx, ddz = pz - cz;
    const d2 = ddx * ddx + ddz * ddz;
    if (d2 < bd2) { bd2 = d2; bx2 = cx; bz2 = cz; }
  }
  out.x = bx2; out.z = bz2;
  return bd2;
}

export function createGeoSpawner() {
  return new GeoSpawner();
}

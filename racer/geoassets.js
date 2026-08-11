/**
 * racer/geoassets.js — GLB model registry for the geo spawner.
 *
 * Loads the island / mountain / land-ring GLBs shipped under
 * assets/3D/models/ (the same art the legacy platformer uses) and exposes
 * them as per-kind model entries with footprint metadata so racer/geospawner.js
 * can place, render (precached island shading) and collide (AABB) each
 * instance.
 *
 * Model entry:
 *   id        — registry key
 *   kind      — island | mountain | landRing
 *   meshData  — raw GLB arrays (vertices/normals/indices/colors); localCX/Y/Z
 *               are stamped on it because buildMeshTris reads them for pivoting
 *   scale     — uniform scale that fits the model to the racer's target size
 *   halfW     — X half-extent in world units (post-scale)
 *   halfD     — Z half-extent in world units (post-scale)
 *   topY      — vertical half-extent in world units (post-scale); with the
 *               pivot on the terrain surface this is the height poking above
 *   faceCount — triangle count (entries with 0 faces are dropped)
 *
 * Sink knob (KIND_DEFAULTS, per-kind, overridable per level):
 *   sink = 1  → midpoint inset: pivot on the terrain surface, so the top half
 *               of the model pokes through and the bottom half is buried.
 *   sink = 0  → the model's base rests on the surface (nothing buried).
 */
import { loadGLBMeshIfAvailable } from "../engine/geometry.js";
import { assetUrl } from "../engine/asseturls.js";

export const GEO_KINDS = ["island", "mountain", "landRing"];

// Default footprint target (half-extent, world units) + sink per kind.
export const KIND_DEFAULTS = {
  island:   { targetHalf: 12, sink: 1.0 },
  mountain: { targetHalf: 22, sink: 1.0 },
  landRing: { targetHalf: 30, sink: 1.0 },
};

const REGISTRY = [
  { kind: "island",   id: "island_a",    url: "assets/3D/models/island_A_model.glb" },
  { kind: "island",   id: "island_b",    url: "assets/3D/models/island_B_model.glb" },
  { kind: "island",   id: "island_c",    url: "assets/3D/models/island_C_model.glb" },
  { kind: "island",   id: "island_d",    url: "assets/3D/models/island_D_model.glb" },
  { kind: "island",   id: "island_e",    url: "assets/3D/models/island_E_model.glb" },
  { kind: "island",   id: "island_g",    url: "assets/3D/models/island_G_model.glb" },
  { kind: "mountain", id: "mountain_a",  url: "assets/3D/models/mountain_A_model.glb" },
  { kind: "mountain", id: "mountain_b",  url: "assets/3D/models/mountain_B_model.glb" },
  { kind: "landRing", id: "land_ring_a", url: "assets/3D/models/LandRing_A.glb" },
  { kind: "landRing", id: "land_ring_b", url: "assets/3D/models/LandRing_B.glb" },
  { kind: "landRing", id: "land_ring_c", url: "assets/3D/models/LandRing_C.glb" },
];

const MODELS = {};        // id → entry
let _ready = false;
let _loadProm = null;

export function isGeoAssetsReady() { return _ready; }
export function getGeoModel(id) { return MODELS[id] || null; }

/** All loaded entries for a kind (empty until loadGeoAssets resolves). */
export function getGeoModelsByKind(kind) {
  if (!GEO_KINDS.includes(kind)) return [];
  const out = [];
  for (const r of REGISTRY) {
    if (r.kind === kind && MODELS[r.id]) out.push(MODELS[r.id]);
  }
  return out;
}

export function geoKindDefault(kind) {
  return KIND_DEFAULTS[kind] || { targetHalf: 12, sink: 1.0 };
}

/** Load every registered GLB once (safe to call repeatedly; cached promise). */
export async function loadGeoAssets() {
  if (_loadProm) return _loadProm;
  _loadProm = _doLoad();
  return _loadProm;
}

async function _doLoad() {
  const results = await Promise.allSettled(REGISTRY.map(async (r) => {
    const mesh = await loadGLBMeshIfAvailable(assetUrl(r.url), `geo ${r.id}`, false);
    if (!mesh) return { id: r.id, entry: null, reason: "mesh unavailable" };
    const entry = _buildEntry(r.id, r.kind, mesh, KIND_DEFAULTS[r.kind].targetHalf);
    return { id: r.id, entry, reason: entry ? null : "0 collision faces" };
  }));

  for (const res of results) {
    if (res.status === "fulfilled" && res.value.entry) {
      MODELS[res.value.id] = res.value.entry;
    } else if (res.status === "fulfilled") {
      console.warn(`[geoassets] skipped ${res.value.id}: ${res.value.reason}`);
    } else {
      console.warn("[geoassets] load failed:", res.reason);
    }
  }

  _ready = true;
  console.log(
    `[geoassets] ready — ${Object.keys(MODELS).length}/${REGISTRY.length} models`,
    GEO_KINDS.map((k) => `${k}:${getGeoModelsByKind(k).length}`).join(" ")
  );
  return MODELS;
}

// Mirror game/islandatlas.js _buildModel: measure the raw GLB bounds, pick a
// uniform scale that fits targetHalf, and record footprint + pivot metadata.
function _buildEntry(id, kind, meshData, targetHalf) {
  const verts = meshData.vertices;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < verts.length; i += 3) {
    const x = verts[i], y = verts[i + 1], z = verts[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const rawHalfW = (maxX - minX) * 0.5;
  const rawHalfD = (maxZ - minZ) * 0.5;
  const scaleW = rawHalfW > 0.0001 ? targetHalf / rawHalfW : 1;
  const scaleD = rawHalfD > 0.0001 ? targetHalf / rawHalfD : 1;
  const scale = Math.min(scaleW, scaleD);

  const localCX = (minX + maxX) * 0.5;
  const localCY = (minY + maxY) * 0.5;
  const localCZ = (minZ + maxZ) * 0.5;
  meshData.localCX = localCX;
  meshData.localCY = localCY;
  meshData.localCZ = localCZ;

  const faceCount = (meshData.indices.length / 3) | 0;
  if (faceCount === 0) return null;

  return {
    id,
    kind,
    meshData,
    scale,
    halfW: rawHalfW * scale,
    halfD: rawHalfD * scale,
    topY: (maxY - (minY + maxY) * 0.5) * scale,
    faceCount,
    localCX, localCY, localCZ,
  };
}

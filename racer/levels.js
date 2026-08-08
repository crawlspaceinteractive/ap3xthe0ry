/**
 * racer/levels.js — Level list / course catalog.
 *
 * Every playable map registers here as a LEVELS entry. RacerGame loads by
 * index/id through this list only. The menu COURSES screen scrolls LEVELS.
 *
 * Procedural AHURA RING is always entry 0. Spline-editor JSON maps under
 * assets/3D/maps/ are scanned from manifest.json (drop a .json + add it to
 * the manifest — hydrateLevels() runs at boot).
 *
 * Entry shapes:
 *   { id, name, desc, build: () => track }     — sync procedural
 *   { id, name, desc, src: "assets/...json" } — async spline-editor JSON
 */
import { buildTrack } from "./track.js";
import { loadSplineTrack } from "./trackload.js";

const MAPS_DIR = "assets/3D/maps/";
const MANIFEST_URL = MAPS_DIR + "manifest.json";

export const LEVELS = [
  {
    id: "ahura-ring",
    name: "AHURA RING",
    desc: "The original 1.5km loop — sweeps, one hairpin and the west straight jump.",
    build: () => buildTrack({ applyDefaultRamp: true }),
  },
];

let _hydrated = false;

/** Index → level def (wraps so out-of-range indices fall back cleanly). */
export function getLevelDef(idx) {
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, idx | 0))] || LEVELS[0];
}

/** id string → index, or -1 if missing. */
export function findLevelIndex(id) {
  if (id == null || id === "") return -1;
  const key = String(id);
  for (let i = 0; i < LEVELS.length; i++) {
    if (LEVELS[i].id === key) return i;
  }
  return -1;
}

export function levelCount() {
  return LEVELS.length;
}

/**
 * Resolve a level list entry to a runtime track.
 * Uses build() when present, otherwise fetches+parses def.src.
 */
export async function resolveLevelTrack(def) {
  const entry = def || LEVELS[0];
  if (typeof entry.build === "function") {
    return entry.build();
  }
  if (entry.src) {
    return loadSplineTrack(entry.src);
  }
  throw new Error(`resolveLevelTrack: level "${entry.id}" has neither build nor src`);
}

/**
 * Scan assets/3D/maps/manifest.json and append any missing spline tracks
 * to LEVELS. Safe to call more than once. Returns the LEVELS array.
 */
export async function hydrateLevels() {
  if (_hydrated) return LEVELS;
  _hydrated = true;
  try {
    const res = await fetch(MANIFEST_URL);
    if (!res.ok) {
      console.warn("[levels] manifest fetch failed", res.status);
      return LEVELS;
    }
    const data = await res.json();
    const tracks = Array.isArray(data.tracks) ? data.tracks : [];
    for (const t of tracks) {
      if (!t || !t.file) continue;
      const id = t.id || String(t.file).replace(/\.json$/i, "");
      if (findLevelIndex(id) >= 0) continue;
      const file = String(t.file).replace(/^.*\//, "");
      LEVELS.push({
        id,
        name: (t.name || id).toUpperCase(),
        desc: t.desc || "Spline editor course.",
        src: MAPS_DIR + file,
      });
    }
  } catch (err) {
    console.warn("[levels] hydrate failed", err);
  }
  return LEVELS;
}

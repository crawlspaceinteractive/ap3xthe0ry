/**
 * levelformat.js — Froyo Engine level format spec + validator (Phase 2.1)
 *
 * ── LEVEL FORMAT v1 (JSON) ──────────────────────────────────────────────────
 * A level is a "scene JSON" document. Producers: tools/scene-editor.html,
 * worldToSceneData() (engine worldgen snapshot).
 * Consumer: sceneDataToWorld() in tools/mapgen-export.js.
 *
 * {
 *   _version: 1,
 *   biome?:    "grass"|"ice"|"sand"|"bubblegum"|"jungle"|"golden"|"volcanic",
 *                                    // top-level token (v1, optional): sets the
 *                                    // level's TERRAIN biome AND sky palette.
 *   skyBiome?: "ice"|"grass"|"sand"|"bubblegum"|"volcanic"|"default",
 *                                    // optional override: sky palette only
 *                                    // (takes precedence over `biome` for sky).
 *   meta:    { source, createdAt?, seed?, renderer },
 *   mapgen?: {                       // engine-level data (all optional)
 *     levelBiome: "grass"|"ice"|"sand"|"bubblegum"|"jungle"|"golden"|"volcanic",
 *     spawn:  {x,y,z},  portal: {x,y,z,target,radius},
 *     crystals|enemies|breakables|decorations|windZones: [...],
 *     platforms: [ { type, x,y,z, sx,sy,sz, biome, glbName, glbScaleMul,
 *                    moving, moveAxis, moveAmp, oneWay?, blocks: [...] } ],
 *   },
 *   objects: [ {                     // editor view of the level
 *     name, type: "GLB"|"PRIM"|"EMPTY",
 *     transform: { position:[x,y,z], rotation:[x,y,z], scale:[x,y,z] },
 *     mapgen?: {                     // per-object engine data
 *       worldType: "island"|"parent"|"bridge",
 *       biome, glbName?, glbScaleMul?, oneWay?, blocks?,
 *       inlineMesh?: { bin: <base64 IMSH> }   // embedded triangle geometry
 *     }
 *   } ]
 * }
 *
 * Entity markers: objects whose NAME contains spawn|player, portal, sun
 * (sun_boss → boss), sprinkle|crystal, crate|breakable are converted to
 * gameplay entities by sceneDataToWorld().
 *
 * ── IMSH embedded mesh binary (base64, little-endian) ──────────────────────
 *   [0..3]  magic 'IMSH'
 *   u32 vCount — FLOAT count of vertex array (3 × numVerts)
 *   u32 nCount — FLOAT count of normal array (0 = none)
 *   u32 iCount — index count (3 × numTris)
 *   u32 cCount — BYTE count of vertex colors (0 = none)
 *   f32×vCount vertices, f32×nCount normals, u32×iCount indices, u8×cCount colors
 */

export const LEVEL_FORMAT_VERSION = 1;

export const VALID_BIOMES = new Set([
  "grass", "ice", "sand", "bubblegum", "jungle", "golden", "volcanic", "default",
]);

// Sky gradient palettes available in game/skypalette.js (no jungle/golden —
// those terrain biomes fall back to the default sky palette).
export const VALID_SKY_BIOMES = new Set([
  "ice", "grass", "sand", "bubblegum", "volcanic", "default",
]);

function isVec3(a) {
  return Array.isArray(a) && a.length >= 3 && a.every(n => typeof n === "number" && isFinite(n));
}

function checkInlineMesh(bin, where, errors) {
  if (typeof bin !== "string" || bin.length < 28) {
    errors.push(`${where}: inlineMesh.bin is not a base64 string`);
    return;
  }
  try {
    const head = atob(bin.slice(0, 40)); // enough for magic + header
    if (head.charCodeAt(0) !== 0x49 || head.charCodeAt(1) !== 0x4d ||
        head.charCodeAt(2) !== 0x53 || head.charCodeAt(3) !== 0x48) {
      errors.push(`${where}: inlineMesh.bin bad magic (expected 'IMSH')`);
    }
  } catch (e) {
    errors.push(`${where}: inlineMesh.bin base64 decode failed`);
  }
}

/**
 * Validate a parsed level JSON document.
 * Returns { ok, errors: string[], warnings: string[] }.
 * `ok` is false only for structural problems that would break loading;
 * warnings flag things the loader will silently default.
 */
export function validateLevel(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== "object") {
    return { ok: false, errors: ["level is not an object"], warnings };
  }
  if (data._version !== undefined && data._version !== LEVEL_FORMAT_VERSION) {
    warnings.push(`unknown _version ${data._version} (expected ${LEVEL_FORMAT_VERSION})`);
  }

  const hasPlatforms = Array.isArray(data.mapgen?.platforms) && data.mapgen.platforms.length > 0;
  const hasObjects   = Array.isArray(data.objects) && data.objects.length > 0;
  if (!hasPlatforms && !hasObjects) {
    errors.push("level has neither mapgen.platforms nor objects[] — nothing to load");
  }

  const biome = data.mapgen?.levelBiome ?? data.levelBiome ?? data.biome;
  if (biome != null && !VALID_BIOMES.has(String(biome))) {
    warnings.push(`unknown levelBiome "${biome}" — loader will fall back to default`);
  }

  // Sky palette set (game/skypalette.js): ice/grass/sand/bubblegum/volcanic/default.
  // Unknown names are warning-only — the loader falls back to the default palette.
  if (data.skyBiome != null && !VALID_SKY_BIOMES.has(String(data.skyBiome))) {
    warnings.push(`unknown skyBiome "${data.skyBiome}" — sky will fall back to default palette`);
  }

  if (Array.isArray(data.objects)) {
    let spawnSeen = false;
    data.objects.forEach((obj, i) => {
      const where = `objects[${i}] "${obj?.name ?? "?"}"`;
      if (!obj || typeof obj !== "object") { errors.push(`${where}: not an object`); return; }
      if (obj.transform && !isVec3(obj.transform.position)) {
        errors.push(`${where}: transform.position is not [x,y,z]`);
      }
      if (obj.mapgen?.inlineMesh) checkInlineMesh(obj.mapgen.inlineMesh.bin, where, errors);
      const bi = obj.mapgen?.biome;
      if (bi != null && !VALID_BIOMES.has(String(bi))) {
        warnings.push(`${where}: unknown biome "${bi}"`);
      }
      const n = String(obj.name || "").toLowerCase();
      if (n.includes("spawn") || n.includes("player") || n.includes("froyo")) spawnSeen = true;
    });
    if (!spawnSeen && !data.mapgen?.spawn) {
      warnings.push("no spawn marker found — player will spawn at (0,1,0)");
    }
  }

  if (Array.isArray(data.mapgen?.platforms)) {
    data.mapgen.platforms.forEach((p, i) => {
      const where = `mapgen.platforms[${i}]`;
      if (!p || typeof p !== "object") { errors.push(`${where}: not an object`); return; }
      for (const k of ["x", "y", "z"]) {
        if (p[k] !== undefined && (typeof p[k] !== "number" || !isFinite(p[k]))) {
          errors.push(`${where}: ${k} is not a finite number`);
        }
      }
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

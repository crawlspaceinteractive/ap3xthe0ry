/**
 * racer/biomes.js — Biome palette + tint table for the racer.
 *
 * Biomes come from the track's top-level `biome` / `skyBiome` keywords
 * (spline-editor export, applied in trackload.js) and use the SAME vocabulary
 * as the legacy platformer (game/world.js PALETTES): grass, ice, sand,
 * bubblegum, jungle, golden + default.
 *
 * The legacy palette literals (0xFFrrggbb) carry the designer's RGB in the low
 * 24 bits (e.g. 0xffffb050 = gold), so top/side convert straight to the racer's
 * ABGR painter colors via rgba(r,g,b). ground/apron/road are the per-biome
 * tints the track renderer paints its floor, off-road apron and road surface
 * with; default mirrors the racer's original hardcoded tints so existing maps
 * look unchanged.
 */
import { rgba } from "../engine/ps1fx.js";
import { getBiomeTextures } from "../game/textureatlas.js";

export const DEFAULT_BIOME = "grass";

const BIOMES = {
  default: {
    name: "default",
    top: rgba(91, 141, 58),
    side: rgba(90, 58, 42),
    ground: rgba(215, 235, 210),
    apron: rgba(215, 235, 210),
    road: rgba(230, 230, 232),
  },
  grass: {
    name: "grass",
    top: rgba(91, 141, 58),
    side: rgba(90, 58, 42),
    ground: rgba(215, 235, 210),
    apron: rgba(215, 235, 210),
    road: rgba(230, 230, 232),
  },
  ice: {
    name: "ice",
    top: rgba(255, 255, 255),
    side: rgba(74, 117, 200),
    ground: rgba(222, 232, 246),
    apron: rgba(206, 220, 240),
    road: rgba(226, 232, 240),
  },
  sand: {
    name: "sand",
    top: rgba(217, 191, 119),
    side: rgba(90, 58, 26),
    ground: rgba(235, 220, 182),
    apron: rgba(222, 204, 164),
    road: rgba(233, 226, 208),
  },
  bubblegum: {
    name: "bubblegum",
    top: rgba(255, 153, 255),
    side: rgba(176, 80, 192),
    ground: rgba(250, 206, 242),
    apron: rgba(238, 188, 230),
    road: rgba(240, 226, 240),
  },
  jungle: {
    name: "jungle",
    top: rgba(128, 232, 128),
    side: rgba(42, 106, 42),
    ground: rgba(172, 222, 160),
    apron: rgba(152, 206, 142),
    road: rgba(222, 228, 220),
  },
  golden: {
    name: "golden",
    top: rgba(255, 176, 80),
    side: rgba(154, 90, 16),
    ground: rgba(250, 226, 150),
    apron: rgba(236, 208, 130),
    road: rgba(236, 230, 205),
  },
};

/** Coerce any value to a known biome name (unknown/missing → default). */
export function normalizeBiome(name) {
  return typeof name === "string" &&
    Object.prototype.hasOwnProperty.call(BIOMES, name) ? name : DEFAULT_BIOME;
}

/** Resolve a biome name (or object) to its palette entry. */
export function getBiome(name) {
  return BIOMES[normalizeBiome(name)];
}

export const BIOME_NAMES = Object.keys(BIOMES).filter((k) => k !== "default");

/**
 * Terrain texture URLs for a biome's top / side / under zones — carried over
 * from the legacy platformer registry (game/textureatlas.js BIOME_TEXTURES).
 * Load the returned URLs once at boot (loadTexture, wrap:true) and pass the
 * loaded objects back through the geo palette so GLB islands/mountains/rings
 * render with per-zone textures instead of flat tints.
 */
export function getBiomeTextureUrls(name) {
  const t = getBiomeTextures(normalizeBiome(name));
  return { top: t.top, side: t.side, under: t.under };
}

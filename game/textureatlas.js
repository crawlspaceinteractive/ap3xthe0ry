// game/textureatlas.js
// Central texture path + biome zone registry.
// Asset URLs injected from user-provided uploads.

import { assetUrl } from "../engine/asseturls.js";

export const TEXTURE_BASE = "./textures/"; // kept for legacy reference

export const TEX = {
  terrain: {
    grass:    assetUrl("assets/2D/textures/base/grass.png"),
    dirt:     assetUrl("assets/2D/textures/base/dirt.png"),
    rock:     assetUrl("assets/2D/textures/base/rock.png"),
    sand:     assetUrl("assets/2D/textures/base/sand.png"),
    snow:     assetUrl("assets/2D/textures/base/snow.png"),
    ice:      assetUrl("assets/2D/textures/base/ice.png"),
    candy:    assetUrl("assets/2D/textures/base/candy.png"),
    volcanic: assetUrl("assets/2D/textures/base/volcanic.png"),
    water_a:  assetUrl("assets/2D/textures/base/water_a.png"),
    water_b:  assetUrl("assets/2D/textures/base/water_b.png"),
  },

  effects: {
    portal:  null,
    sparkle: null,
  },

  ui: {
    icons: null,
  },
};

export const ZONE = {
  TOP: "top",
  SIDE: "side",
  UNDER: "under",
  ACCENT: "accent",
};

export const BIOME_TEXTURES = {
  grass: {
    top: TEX.terrain.grass,
    side: TEX.terrain.dirt,
    under: TEX.terrain.rock,
    accent: TEX.terrain.grass,
  },

  ice: {
    top: TEX.terrain.snow,
    side: TEX.terrain.ice,
    under: TEX.terrain.dirt,
    accent: TEX.terrain.ice,
  },

  sand: {
    top: TEX.terrain.sand,
    side: TEX.terrain.sand,
    under: TEX.terrain.rock,
    accent: TEX.terrain.sand,
  },

  bubblegum: {
    top: TEX.terrain.candy,
    side: TEX.terrain.dirt,
    under: TEX.terrain.rock,
    accent: TEX.terrain.candy,
  },

  jungle: {
    top: TEX.terrain.grass,
    side: TEX.terrain.dirt,
    under: TEX.terrain.rock,
    accent: TEX.terrain.grass,
  },

  golden: {
    top: TEX.terrain.sand,
    side: TEX.terrain.rock,
    under: TEX.terrain.rock,
    accent: TEX.terrain.sand,
  },

  volcanic: {
    top: TEX.terrain.volcanic,
    side: TEX.terrain.rock,
    under: TEX.terrain.rock,
    accent: TEX.terrain.volcanic,
  },

  default: {
    top: TEX.terrain.grass,
    side: TEX.terrain.dirt,
    under: TEX.terrain.rock,
    accent: TEX.terrain.grass,
  },
};

export const DEFAULT_BIOME = "grass";
export const DEFAULT_SKY_BIOME = "ice";

export const SKY_BIOME_TEXTURES = {

    ice: {
        top: TEX.terrain.snow,
        side: TEX.terrain.rock,
        under: TEX.terrain.rock,
        accent: TEX.terrain.ice
    },

    volcanic: {
        top: TEX.terrain.volcanic,
        side: TEX.terrain.rock,
        under: TEX.terrain.rock,
        accent: TEX.terrain.volcanic
    },

    grass: {
        top: TEX.terrain.grass,
        side: TEX.terrain.rock,
        under: TEX.terrain.rock,
        accent: TEX.terrain.grass
    },

    sand: {
        top: TEX.terrain.sand,
        side: TEX.terrain.rock,
        under: TEX.terrain.rock,
        accent: TEX.terrain.sand
    },

    default: {
        top: TEX.terrain.snow,
        side: TEX.terrain.rock,
        under: TEX.terrain.rock,
        accent: TEX.terrain.ice
    }
};

export function getBiomeTextures(biome) {

    return (
        BIOME_TEXTURES[
            biome || DEFAULT_BIOME
        ] ||
        BIOME_TEXTURES.default
    );

}

export function getZoneTexture(
    biome,
    zone
) {

    const table =
        getBiomeTextures(biome);

    return (
        table[zone] ||
        table.side ||
        null
    );

}

export function getSkyBiomeTextures(
    biome
) {

    return (
        SKY_BIOME_TEXTURES[
            biome || DEFAULT_SKY_BIOME
        ] ||
        SKY_BIOME_TEXTURES.default
    );

}

export function getSkyZoneTexture(
    biome,
    zone
) {

    const table =
        getSkyBiomeTextures(
            biome
        );

    return (
        table[zone] ||
        table.side ||
        null
    );

}

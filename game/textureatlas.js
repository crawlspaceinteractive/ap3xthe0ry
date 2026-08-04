// game/textureatlas.js
// Central texture path + biome zone registry.
// Asset URLs injected from user-provided uploads.

export const TEXTURE_BASE = "./textures/"; // kept for legacy reference

export const TEX = {
  terrain: {
    grass:    "assets/2D/textures/grass.png",
    dirt:     "assets/2D/textures/dirt.png",
    rock:     "assets/2D/textures/rock.png",
    sand:     "assets/2D/textures/sand.png",
    snow:     "assets/2D/textures/snow.png",
    ice:      "assets/2D/textures/ice.png",
    candy:    "assets/2D/textures/candy.png",
    volcanic: "assets/2D/textures/volcanic.png",
    water_a:  "assets/2D/textures/water_a.png",
    water_b:  "assets/2D/textures/water_b.png",
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

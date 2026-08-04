/**
 * hubworld.js — Phase 4.3 HUB WORLD (level-select island)
 *
 *   The hub is a special non-combat world: the portal island (IslandF, 2×)
 *   at the origin, ringed by one "portal pad" per game world. Each pad
 *   carries a warp portal tinted in its world's biome palette and a sign
 *   with the world's name rendered in 3D BLOCK LETTERS (bitmap-font glyphs
 *   extruded into oriented planks, flipped to face outward from the hub).
 *
 *   Output world shape matches generateWorld() so game.js/physics/renderer
 *   need no special-casing beyond:
 *     world.isHub        : true
 *     world.hubPortals[] : { x,y,z,radius, worldNum, name, biome, locked,
 *                            reqSprinkles, top, side }
 *     world.hubSigns[]   : { x,y,z, ax,az (text axis, unit XZ), depth,
 *                            top, side, locked, runs:[{o, y, halfLen, halfH}] }
 *   world.portal is parked far below the void so the legacy single-portal
 *   trigger/render path can never fire in the hub.
 *
 *   Unlock rule (game.js enforces): portal N is unlocked when
 *     save.worldsCleared >= N-1  AND  save.sprinkles >= reqSprinkles.
 */
import { getPortalIslandModel, isAtlasReady } from "./islandatlas.js";
import { TUN_ISLANDS, TUN_PORTAL, hexToABGR } from "./tunables.js";

const S = 8.0;

// One entry per playable world — biome names must exist in world.js PALETTES
// (game.js passes `biome` straight into generateWorld). Names are kept ≤ 9
// chars so the 3D letter signs fit on a pad. Dessert-flavored per biome.
export const HUB_WORLDS = [
  { num: 1, biome: "ice",       name: "ICE CREAM", reqSprinkles: 0   },
  { num: 2, biome: "grass",     name: "MINT CHIP", reqSprinkles: 25  },
  { num: 3, biome: "sand",      name: "CARAMEL",   reqSprinkles: 75  },
  { num: 4, biome: "bubblegum", name: "BUBBLEGUM", reqSprinkles: 150 },
  { num: 5, biome: "jungle",    name: "PISTACHIO", reqSprinkles: 250 },
  { num: 6, biome: "golden",    name: "HONEYCOMB", reqSprinkles: 400 },
];

// Terrain palettes — mirror of world.js PALETTES (ABGR packed).
const PAD_PALETTES = {
  grass:     { top: 0xff5b8d3a, side: 0xff5a3a2a },
  ice:       { top: 0xffffffff, side: 0xff4a75c8 },
  sand:      { top: 0xffd9bf77, side: 0xff5a3a1a },
  bubblegum: { top: 0xffff99ff, side: 0xffb050c0 },
  jungle:    { top: 0xff80e880, side: 0xff2a6a2a },
  golden:    { top: 0xffffb050, side: 0xff9a5a10 },
};

// ── 4x5 bitmap font (mirror of engine/renderer.js FONT — A-Z / 0-9 / space).
// Each glyph: 20 bits, row-major top→bottom, 4 bits per row, MSB = left.
const FONT = {
  "0": 0x69996, "1": 0x4c44e, "2": 0xe168f, "3": 0xe161e, "4": 0x99f11,
  "5": 0xf8e1e, "6": 0x68e96, "7": 0xf1244, "8": 0x69696, "9": 0x69716,
  "A": 0x69f99, "B": 0xe9e9e, "C": 0x78887, "D": 0xe999e, "E": 0xf8e8f,
  "F": 0xf8e88, "G": 0x78b97, "H": 0x99f99, "I": 0xe444e, "J": 0x722a4,
  "K": 0x9aca9, "L": 0x8888f, "M": 0x9ff99, "N": 0x9dfb9, "O": 0x69996,
  "P": 0xe9e88, "Q": 0x699b7, "R": 0xe9ea9, "S": 0x7861e, "T": 0xf4444,
  "U": 0x99996, "V": 0x99966, "W": 0x99ff9, "X": 0x96669, "Y": 0x99644,
  "Z": 0xf168f, " ": 0, "-": 0x00e00, "!": 0x44404,
};

/**
 * Convert a string into 3D letter geometry: horizontal RLE runs of set font
 * pixels. Returns { runs, width } where each run is
 *   { o: center offset along text axis (world units, 0 = text center),
 *     y: center height above text baseline, halfLen, halfH }
 * `cell` = world-unit size of one font pixel. Runs merge adjacent set pixels
 * per row so a 9-char name is ~40 planks instead of ~180 cubes.
 */
export function buildTextRuns(text, cell = 0.55) {
  text = String(text).toUpperCase();
  const cols = text.length * 5 - 1;       // 4px glyph + 1px gap, last gap trimmed
  const width = cols * cell;
  const runs = [];
  for (let row = 0; row < 5; row++) {
    let runStart = -1;
    const flush = (endCol) => {
      if (runStart < 0) return;
      const len = endCol - runStart;
      runs.push({
        o: (runStart + len * 0.5) * cell - width * 0.5,
        y: (4 - row) * cell + cell * 0.5,   // row 0 = top of glyph
        halfLen: len * cell * 0.5,
        halfH: cell * 0.5,
      });
      runStart = -1;
    };
    for (let i = 0; i < text.length; i++) {
      const glyph = FONT[text[i]] ?? 0;
      const bits = (glyph >>> ((4 - row) * 4)) & 0xf;
      for (let gx = 0; gx < 4; gx++) {
        const col = i * 5 + gx;
        if ((bits >>> (3 - gx)) & 1) {
          if (runStart < 0) runStart = col;
        } else flush(col);
      }
      flush(i * 5 + 4); // glyph gap column always empty
    }
    flush(cols + 1);
  }
  return { runs, width };
}

// ── Hub parent island (same construction as world.js buildPortalIsland) ─────
function buildHubParentIsland() {
  const PARENT_TOP  = hexToABGR(TUN_ISLANDS.parentTopColor);
  const PARENT_SIDE = hexToABGR(TUN_ISLANDS.parentSideColor);
  const model = getPortalIslandModel();
  if (isAtlasReady() && model) {
    const MUL = 2.0;
    const topY = model.topY * MUL;
    return {
      x: 0, y: topY, z: 0,
      sx: model.halfW * MUL, sz: model.halfD * MUL, sy: topY,
      color: PARENT_TOP, side: PARENT_SIDE,
      type: "parent", blocks: [],
      topY, portalY: topY,
      glbModel: model, glbName: model.id || null,
      glbWorldX: 0, glbWorldY: 0, glbWorldZ: 0,
      glbScaleMul: MUL,
      isPortalIsland: true,
    };
  }
  // Fallback: procedural tiered island (atlas not ready yet)
  const baseW = 5.5 * S, baseH = 0.5 * S;
  return {
    x: 0, y: baseH, z: 0,
    sx: baseW, sz: baseW, sy: baseH,
    color: PARENT_TOP, side: PARENT_SIDE,
    type: "parent",
    blocks: [{ ox: 0, oy: 0, oz: 0, wx: 0, wy: 0, wz: 0, sx: baseW, sy: baseH, sz: baseW, top: PARENT_TOP, side: PARENT_SIDE }],
    topY: baseH, portalY: baseH,
    isPortalIsland: true,
  };
}

/**
 * Generate the hub world.
 * @param {object} opts { worldsCleared: number, sprinkles: number }
 */
export function generateHubWorld(opts = {}) {
  const worldsCleared = opts.worldsCleared ?? 0;
  const sprinkles     = opts.sprinkles ?? 0;

  const platforms = [];
  const parent = buildHubParentIsland();
  platforms.push(parent);

  const spawn = { x: 0, y: parent.topY + 1.0, z: 0 };
  const clearR = Math.max(parent.sx, parent.sz);
  const portalTop = parent.topY;

  const PAD_HALF = 2.0 * S;               // pad half-extent (16)
  const PAD_H    = 0.3 * S;               // pad half-height
  const RING_R   = clearR * 1.30;         // pad center radius
  const PAD_TOP  = portalTop - 0.25 * S;  // slightly below parent top

  const hubPortals = [];
  const hubSigns   = [];

  for (let i = 0; i < HUB_WORLDS.length; i++) {
    const w = HUB_WORLDS[i];
    const pal = PAD_PALETTES[w.biome] || PAD_PALETTES.grass;
    const th = -Math.PI / 2 + (i * Math.PI * 2) / HUB_WORLDS.length;
    const dx = Math.cos(th), dz = Math.sin(th);   // outward dir
    const ax = dz, az = -dx;                      // flipped text/tangent axis
    const cx = dx * RING_R, cz = dz * RING_R;

    const locked = !(worldsCleared >= w.num - 1 && sprinkles >= w.reqSprinkles);

    // ── Pad platform (single biome-tinted slab) ──────────────────────────
    platforms.push({
      x: cx, y: PAD_TOP, z: cz,
      sx: PAD_HALF, sz: PAD_HALF, sy: PAD_H,
      color: pal.top, side: pal.side,
      type: "island", biome: w.biome,
      blocks: [{
        wx: cx, wy: PAD_TOP - PAD_H, wz: cz,
        sx: PAD_HALF, sy: PAD_H, sz: PAD_HALF,
        top: pal.top, side: pal.side,
      }],
      _hubPadFor: w.num,
    });

    // ── Stepping stones: parent edge → pad edge (one-way hop platforms) ──
    const a0 = clearR * 0.90;                    // start just inside parent rim
    const a1 = RING_R - PAD_HALF * 0.85;         // end at pad inner edge
    const STONES = 3;
    for (let s = 1; s <= STONES; s++) {
      const t = s / (STONES + 1);
      const r = a0 + (a1 - a0) * t;
      const sy = 0.18 * S;
      const topY = portalTop + (PAD_TOP - portalTop) * t - Math.sin(t * Math.PI) * 0.4 * S;
      const hw = 0.55 * S;
      platforms.push({
        x: dx * r, y: topY, z: dz * r,
        sx: hw, sz: hw, sy,
        oneWay: true,
        color: pal.top, side: pal.side, type: "hop",
        blocks: [{ wx: dx * r, wy: topY - sy, wz: dz * r, sx: hw, sy, sz: hw, top: pal.top, side: pal.side }],
      });
    }

    // ── Portal (outer part of the pad) ───────────────────────────────────
    const px = cx + dx * PAD_HALF * 0.35;
    const pz = cz + dz * PAD_HALF * 0.35;
    hubPortals.push({
      x: px, y: PAD_TOP + 0.6 * S + TUN_PORTAL.heightOffset, z: pz,
      radius: 1.0 * S * TUN_PORTAL.size,
      worldNum: w.num, name: w.name, biome: w.biome,
      locked, reqSprinkles: w.reqSprinkles,
      top: pal.top, side: pal.side,
    });

    // ── 3D letter sign (inner part of the pad, flipped orientation) ──────
    const { runs } = buildTextRuns(w.name, 0.55);
    hubSigns.push({
      x: cx - dx * PAD_HALF * 0.55,
      y: PAD_TOP + 0.35,                 // letter baseline sits on a low curb
      z: cz - dz * PAD_HALF * 0.55,
      ax, az,                            // letters run along the ring tangent
      depth: 0.22,                       // half-depth of each letter plank
      top: pal.top, side: pal.side,
      locked, worldNum: w.num,
      runs,
    });
  }

  // Legacy single portal parked in the void — can never trigger or render.
  const portal = { x: 0, y: -9999, z: 0, radius: 0, target: { ...spawn } };

  return {
    isHub: true,
    spawn, platforms, portal,
    hubPortals, hubSigns,
    crystals: [], enemies: [], breakables: [],
    decorations: [], windZones: [], hazards: [], gems: [],
    voronoiCells: [],
    biome: "bubblegum",     // hub terrain fallback tint
    skyBiome: "bubblegum",  // candy hub sky
  };
}

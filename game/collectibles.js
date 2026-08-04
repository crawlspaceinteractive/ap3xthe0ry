/**
 * collectibles.js — Phase 4.1 Sprinkle/Gem collection (logic only)
 *
 *   Pure logic module — no imports from game.js. World gen calls
 *   spawnGemsOnIsland() per child island; game.js ticks stepGems() and
 *   handles rewards/FX/render.
 *
 *   Gem shape: { x, y, z, type:"gem"|"life", taken, takenT, phase }
 *     - type "gem"  → +1 sprinkle (rotating sprinkle GLB)
 *     - type "life" → +1 extra life (cherry GLB, ~every 5th island)
 *     - takenT      → pickup sparkle-burst countdown (20 → 0)
 */

// 3-5 gems per island, arranged in a small arc cluster on the walk surface.
// Every ~5th island also carries one extra-life pickup at its centre.
export function spawnGemsOnIsland(rand, gems, ix, iz, walkY, halfW, halfD, S, islandIndex) {
  const count = 3 + ((rand() * 3) | 0); // 3..5
  const baseAngle = rand() * Math.PI * 2;
  const step = 0.45 + rand() * 0.35;    // radians between gems along the arc
  const r = Math.min(halfW, halfD) * (0.35 + rand() * 0.25);
  for (let k = 0; k < count; k++) {
    const a = baseAngle + k * step;
    gems.push({
      x: ix + Math.cos(a) * r,
      y: walkY + 0.9,
      z: iz + Math.sin(a) * r,
      type: "gem",
      taken: false,
      takenT: 0,
      phase: rand() * 6.28,
    });
  }
  if (islandIndex % 5 === 4) {
    gems.push({
      x: ix,
      y: walkY + 1.0,
      z: iz,
      type: "life",
      taken: false,
      takenT: 0,
      phase: rand() * 6.28,
    });
  }
}

// Overlap collection + pickup-burst timer decay.
// Returns the array of gems collected THIS frame (game.js awards/plays SFX).
export function stepGems(world, player) {
  const collected = [];
  const gems = world.gems;
  if (!gems || !gems.length) return collected;
  const R2 = 1.3 * 1.3;
  for (const g of gems) {
    if (g.taken) {
      if (g.takenT > 0) g.takenT--;
      continue;
    }
    const dx = player.x - g.x;
    const dz = player.z - g.z;
    const dy = player.y - g.y;
    if (dx * dx + dz * dz < R2 && Math.abs(dy) < 1.8) {
      g.taken = true;
      g.takenT = 20;
      collected.push(g);
    }
  }
  return collected;
}

/**
 * hazards.js — Phase 3.2 static hazards: spikes, lava pads, crush traps.
 *
 *   spawnHazards(rand, islandCentres, bossIdx) — world-gen placement
 *   stepHazards(world, player, frame, hud, flashFn) — per-frame logic
 *   buildHazardTris(hazards, frame, cam, out) — render pass
 *
 * Hazard shapes:
 *   spike   : { type:"spike", x,y,z, radius, spikes:[{ox,oz,r,h,yaw}] } — contact damage
 *   lava    : { type:"lava",  x,y,z, radius } — instant death (respawn flow)
 *   crusher : { type:"crusher", x,y,z, state, t, blockY, restY } — telegraphed slam
 */
import { buildCube, buildTriPrism, rgba } from "../engine/renderer.js";
import { STATE } from "../engine/state.js";

// ─── World-gen placement ─────────────────────────────────────────────────────
export function spawnHazards(rand, islandCentres, bossIdx) {
  const hazards = [];
  let cycle = 0;
  for (let i = 0; i < islandCentres.length; i++) {
    if (i === bossIdx) continue;       // keep the boss arena clean
    if (i % 3 !== 1) continue;         // roughly one hazard per three islands
    const ic = islandCentres[i];
    const half = Math.min(ic.halfW ?? 8, ic.halfD ?? 8);
    const hx = ic.x + (rand() - 0.5) * half * 0.8;
    const hz = ic.z + (rand() - 0.5) * half * 0.8;
    const hy = ic.y; // walk surface

    const kind = cycle % 3; cycle++;
    if (kind === 0) {
      // Spike cluster: 3-5 grey tri-prisms
      const spikes = [];
      const n = 3 + ((rand() * 3) | 0);
      for (let s = 0; s < n; s++) {
        const a = rand() * Math.PI * 2;
        const d = rand() * 2.0;
        spikes.push({
          ox: Math.cos(a) * d,
          oz: Math.sin(a) * d,
          r: 0.5 + rand() * 0.4,
          h: 1.2 + rand() * 0.8,
          yaw: rand() * 360,
        });
      }
      hazards.push({ type: "spike", x: hx, y: hy, z: hz, radius: 3.2, spikes });
    } else if (kind === 1) {
      hazards.push({ type: "lava", x: hx, y: hy, z: hz, radius: 3.0 });
    } else {
      hazards.push({
        type: "crusher", x: hx, y: hy, z: hz,
        state: "wait", t: 0, blockY: hy + 10, restY: hy + 10,
      });
    }
  }
  return hazards;
}

// ─── Per-frame logic ─────────────────────────���───────────────────────────────
export function stepHazards(world, player, frame, hud, flashFn) {
  const hazards = world.hazards || [];
  if (!hazards.length) return;

  const feet = player.y - 0.5;
  const hurt = (hz, kb) => {
    if (player.hitT > 0 || (player.invulnT || 0) > 0 || (player.state & STATE.DEAD)) return;
    player.hitT = 45;
    player.vy = 0.18;
    const dx = player.x - hz.x, dz = player.z - hz.z;
    const norm = Math.sqrt(dx * dx + dz * dz) + 0.001;
    player.vx += (dx / norm) * kb;
    player.vz += (dz / norm) * kb;
    flashFn(hud, "OUCH!", 40);
  };

  for (const hz of hazards) {
    if (hz.type === "spike") {
      if (feet < hz.y - 1 || feet > hz.y + 1.8) continue;
      for (const s of hz.spikes) {
        const dx = player.x - (hz.x + s.ox);
        const dz = player.z - (hz.z + s.oz);
        if (dx * dx + dz * dz < (s.r + 0.6) * (s.r + 0.6)) {
          hurt(hz, 0.15);
          break;
        }
      }
    } else if (hz.type === "lava") {
      const dx = player.x - hz.x, dz = player.z - hz.z;
      if (dx * dx + dz * dz < hz.radius * hz.radius && feet < hz.y + 1.0) {
        // Instant death — game.js death flow handles life loss + respawn
        player.state |= STATE.DEAD;
      }
    } else if (hz.type === "crusher") {
      const dx = player.x - hz.x, dz = player.z - hz.z;
      const dist2D = Math.sqrt(dx * dx + dz * dz);
      switch (hz.state) {
        case "wait":
          if (dist2D < 4 && Math.abs(player.y - hz.y) < 6) {
            hz.state = "telegraph"; hz.t = 20;
          }
          break;
        case "telegraph":
          hz.t--;
          if (hz.t <= 0) hz.state = "slam";
          break;
        case "slam":
          hz.blockY -= 0.9;
          if (hz.blockY <= hz.y + 1.2) {
            hz.blockY = hz.y + 1.2;
            hz.state = "rest"; hz.t = 30;
          }
          break;
        case "rest":
          hz.t--;
          if (hz.t <= 0) hz.state = "rise";
          break;
        case "rise":
          hz.blockY += 0.15;
          if (hz.blockY >= hz.restY) {
            hz.blockY = hz.restY;
            hz.state = "wait";
          }
          break;
      }
      // Overlap check while dangerous (falling block or resting on ground)
      if (hz.state === "slam" || hz.state === "rest") {
        if (Math.abs(dx) < 2.7 && Math.abs(dz) < 2.7 &&
            player.y + 0.5 > hz.blockY - 1.2 && player.y - 0.5 < hz.blockY + 1.2) {
          hurt(hz, 0.35);
        }
      }
    }
  }
}

// ─── Render pass ─────────────────────────────────────────────────────────────
const SPIKE_TOP  = rgba(150, 150, 160);
const SPIKE_SIDE = rgba(90, 90, 100);
const LAVA_SIDE  = rgba(180, 40, 10);
const CRUSH_TOP  = rgba(120, 110, 130);
const CRUSH_SIDE = rgba(70, 60, 80);
const PAD_C      = rgba(120, 20, 20);

export function buildHazardTris(hazards, frame, cam, out) {
  for (const hz of hazards) {
    if (hz.type === "spike") {
      for (const s of hz.spikes) {
        // buildTriPrism: cy = BOTTOM, top = cy + sy*2 → pass h/2 for height h
        const arr = buildTriPrism(hz.x + s.ox, hz.y, hz.z + s.oz,
          s.r, s.h / 2, s.yaw, SPIKE_TOP, SPIKE_SIDE, cam);
        for (const t of arr) out.push(t);
      }
    } else if (hz.type === "lava") {
      const pulse = 0.5 + 0.5 * Math.sin(frame * 0.15);
      const lavaTop = rgba(255, (120 + 80 * pulse) | 0, 30);
      const arr = buildCube(hz.x, hz.y + 0.12, hz.z,
        hz.radius, 0.12, hz.radius, lavaTop, LAVA_SIDE, cam);
      for (const t of arr) out.push(t);
    } else if (hz.type === "crusher") {
      // Danger pad marks the slam zone
      const pad = buildCube(hz.x, hz.y + 0.05, hz.z, 2.5, 0.05, 2.5, PAD_C, PAD_C, cam);
      for (const t of pad) out.push(t);
      // Block — shakes during telegraph
      const shake = hz.state === "telegraph" ? (hz.t % 4 < 2 ? 0.15 : -0.15) : 0;
      const arr = buildCube(hz.x + shake, hz.blockY, hz.z,
        2.5, 1.2, 2.5, CRUSH_TOP, CRUSH_SIDE, cam);
      for (const t of arr) out.push(t);
    }
  }
}

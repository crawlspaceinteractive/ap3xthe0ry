/**
 * racer/levels.js — Level registry. Each level owns its track build (and any
 * future per-level config: sky mood, scenery palette, lap count, best-lap
 * table, etc.). RacerGame swaps levels through loadLevel()/unloadLevel(),
 * so adding a level here is the only place a new course needs declaring.
 *
 * The AHURA RING (default) stays defined in track.js; other levels pass their
 * own control-point table via buildTrack({ cp, halfWidth, sampleSpace }).
 */
import { buildTrack } from "./track.js";

const DEFAULT_CP = [
  // angleDeg, radius, y
  [   0, 118, 0.0 ],   // start/finish zone (east)
  [  28, 126, 0.0 ],
  [  60,  92, 1.5 ],   // inward sweeper
  [  88, 120, 4.5 ],   // uphill
  [ 118, 108, 6.0 ],   // crest
  [ 145,  76, 3.0 ],   // downhill cutback
  [ 175, 118, 0.0 ],   // west straight (jump ramp lives here)
  [ 205, 120, 0.0 ],
  [ 232,  58, 0.0 ],   // HAIRPIN — sharp pull-in
  [ 255, 112, 1.0 ],
  [ 283, 118, 0.0 ],
  [ 310,  94, 1.5 ],   // esses
  [ 335, 112, 0.0 ],
];

export const LEVELS = [
  {
    id: "ahura-ring",
    name: "AHURA RING",
    desc: "The original 1.5km loop — sweeps, one hairpin and the west straight jump.",
    build: () => buildTrack(),
  },
  // Add future levels here, e.g.:
  // {
  //   id: "my-novel",
  //   name: "MY NOVEL",
  //   desc: "...",
  //   build: () => buildTrack({ cp: [...], halfWidth: 7.0 }),
  // },
];

/** Index → level def (wraps so out-of-range indicies fall back cleanly). */
export function getLevelDef(idx) {
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, idx | 0))] || LEVELS[0];
}
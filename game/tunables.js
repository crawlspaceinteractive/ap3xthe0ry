/**
 * tunables.js — Creator tuning sliders (Star editor auto-renders these).
 *
 * Groups cover the game's object categories: size / offset / rotation /
 * colors wherever the engine supports that axis.
 *
 *   RESTART groups (baked at world generation — apply on Save/reload):
 *     stones, bridges, islands, decor  (+ portal heightOffset/trigger radius)
 *   LIVE groups (read every render frame — sliders apply instantly):
 *     player, enemies, portal size/color
 *
 * Rotation is only exposed where the engine can rotate: GLB-rendered meshes
 * (player, enemies). Axis-aligned cube platforms (stones) and procedural
 * deco builders have no yaw path; GLB island yaw would desync face collision.
 */
import { tunable } from "../engine/tunable.js";

// ─── Color helpers ───────────────────────────────────────────────────────────
// Engine colors are 32-bit ABGR (canvas little-endian: 0xAABBGGRR).
// Tunable color values are '#rrggbb' strings.
export function hexToABGR(hex, a = 255) {
  const h = String(hex || "").replace("#", "");
  if (h.length < 6) return 0xffffffff;
  const r = parseInt(h.slice(0, 2), 16) & 0xff;
  const g = parseInt(h.slice(2, 4), 16) & 0xff;
  const b = parseInt(h.slice(4, 6), 16) & 0xff;
  return (((a & 0xff) << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

// Darken an ABGR color toward black. t=0 keeps, t=1 → black.
export function darkenABGR(c, t) {
  const inv = 256 - ((t * 256 + 0.5) | 0);
  const r = ((c & 0xff) * inv) >> 8;
  const g = (((c >>> 8) & 0xff) * inv) >> 8;
  const b = (((c >>> 16) & 0xff) * inv) >> 8;
  return (((c >>> 24) << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

// ─── Stepping stones (world-gen — applies on save) ───────────────────────────
export const TUN_STONES = tunable("stones", {
  size: 1.0,
  spacing: 2.1,
  heightOffset: 0,
  jitter: 1.0,
  topColor: "#3d3846",
  sideColor: "#241f31",
}, {
  size:         { min: 0.25, max: 6,   step: 0.05, label: "Size ×",       restart: true },
  spacing:      { min: 0.8,  max: 4,   step: 0.1,  label: "Hop spacing",  restart: true },
  heightOffset: { min: -10,  max: 10,  step: 0.25, label: "Height offset", restart: true },
  jitter:       { min: 0,    max: 3,   step: 0.1,  label: "Path jitter ×", restart: true },
  topColor:     { kind: "color", label: "Top color",  restart: true },
  sideColor:    { kind: "color", label: "Side color", restart: true },
}, { label: "Stepping Stones" });

// ─── Bridges (world-gen — applies on save) ───────────────────────────────────
export const TUN_BRIDGES = tunable("bridges", {
  width: 0.35,
  sag: 0.65,
  heightOffset: 0,
}, {
  width:        { min: 0.3, max: 3,  step: 0.05, label: "Deck width ×",  restart: true },
  sag:          { min: 0,   max: 3,  step: 0.05, label: "Rope sag",      restart: true },
  heightOffset: { min: -10, max: 10, step: 0.25, label: "Height offset", restart: true },
}, { label: "Bridges" });

// ─── Child islands (world-gen — applies on save) ─────────────────────────────
export const TUN_ISLANDS = tunable("islands", {
  size: 1.0,
  heightOffset: -10,
  parentTopColor: "#5baa3a",
  parentSideColor: "#3a5a2a",
}, {
  size:            { min: 0.3, max: 3,  step: 0.05, label: "Island size ×", restart: true },
  heightOffset:    { min: -20, max: 20, step: 0.5,  label: "Height offset", restart: true },
  parentTopColor:  { kind: "color", label: "Hub top color",  restart: true },
  parentSideColor: { kind: "color", label: "Hub side color", restart: true },
}, { label: "Islands" });

// ─── Biome decorations (world-gen — applies on save) ─────────────────────────
export const TUN_DECOR = tunable("decor", {
  size: 3.0,
  heightOffset: -1,
}, {
  size:         { min: 0.2, max: 4, step: 0.05, label: "Size ×",        restart: true },
  heightOffset: { min: -5,  max: 5, step: 0.1,  label: "Height offset", restart: true },
}, { label: "Decorations" });

// ─── Player (live — read per render frame) ───────────────────────────────────
export const TUN_PLAYER = tunable("player", {
  size: 3,
  rotation: 90,
}, {
  size:     { min: 0.3, max: 3,   step: 0.05, label: "Model size ×" },
  rotation: { min: -180, max: 180, step: 5,   label: "Yaw offset °" },
}, { label: "Player" });

// ─── Enemies (live — read per render frame) ──────────────────────────────────
export const TUN_ENEMIES = tunable("enemies", {
  size: 1.0,
  heightOffset: 0,
  rotation: 0,
}, {
  size:         { min: 0.3, max: 3,   step: 0.05, label: "Model size ×" },
  heightOffset: { min: -5,  max: 5,   step: 0.1,  label: "Hover offset" },
  rotation:     { min: -180, max: 180, step: 5,   label: "Yaw offset °" },
}, { label: "Enemies" });

// ─── Portal (color/size live; height & trigger radius bake at world-gen) ─────
export const TUN_PORTAL = tunable("portal", {
  size: 1.0,
  heightOffset: 0,
  color: "#ff50dc",
}, {
  size:         { min: 0.3, max: 3,  step: 0.05, label: "Size ×" },
  heightOffset: { min: -15, max: 15, step: 0.5,  label: "Height offset", restart: true },
  color:        { kind: "color", label: "Portal color" },
}, { label: "Portal" });

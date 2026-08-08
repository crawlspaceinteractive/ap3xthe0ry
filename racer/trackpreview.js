/**
 * racer/trackpreview.js — Isometric wireframe "hologram" preview for the
 * COURSES menu. Resolves a level's track once (cached by id), decimates the
 * centerline + edge rails to a lightweight point set, and re-projects them
 * every frame with a fixed 30° isometric transform PLUS a slow rotation
 * about the vertical (Y) axis, so the hologram itself spins in place for an
 * orange wireframe readout drawn over the COURSES panel.
 *
 * This is drawn on top of trackglobe.js's static globe (see menus.js
 * _drawCourses) — the globe does not rotate; only this hologram does.
 *
 * Usage (see menus.js _drawCourses):
 *   const entry = getPreview(LEVELS[courseRow]);
 *   drawHologram(rd, entry, x, y, w, h, frame);
 *
 * getPreview() is safe to call every draw frame — it's a cache lookup once
 * the track has resolved; the async resolve only fires once per level id.
 */
import { drawLine, drawThickLine, drawRect, drawCircle, drawText, rgba } from "../engine/renderer.js";
import { resolveLevelTrack } from "./levels.js";

const MAX_POINTS = 90;                  // decimated centerline point cap
const ISO_COS = Math.cos(Math.PI / 6);  // 30°
const ISO_SIN = Math.sin(Math.PI / 6);
const ROT_SPEED = 0.014;                // hologram spin rate, radians/frame

const HOLO     = rgba(255, 128, 8);   // matches menus.js ACCENT
const HOLO_HOT = rgba(255, 195, 120);
const NO_SIG   = rgba(200, 70, 50);

const _cache = new Map(); // level id -> preview entry

function isoXY(x, y, z) {
  return { ix: (x - z) * ISO_COS, iy: (x + z) * ISO_SIN - y };
}

// Rotate a point about the vertical (Y) axis, in the horizontal (X/Z) plane.
function rotateXZ(x, z, cosA, sinA) {
  return { x: x * cosA - z * sinA, z: x * sinA + z * cosA };
}

function decimate(samples, max) {
  const n = samples.length;
  if (n <= max) return samples.slice();
  const out = [];
  const step = n / max;
  for (let i = 0; i < max; i++) out.push(samples[(i * step) | 0]);
  return out;
}

function computeBoundsIso(pts, base) {
  let minIx = Infinity, maxIx = -Infinity, minIy = Infinity, maxIy = -Infinity;
  const consider = (p) => {
    if (p.ix < minIx) minIx = p.ix;
    if (p.ix > maxIx) maxIx = p.ix;
    if (p.iy < minIy) minIy = p.iy;
    if (p.iy > maxIy) maxIy = p.iy;
  };
  for (const p of pts) { consider(p.c); consider(p.L); consider(p.R); }
  for (const b of base) consider(b);
  return { minIx, maxIx, minIy, maxIy };
}

/**
 * Cache-or-resolve a level's hologram data. Returns the cache entry
 * immediately: { status: "loading" } on first call, then mutates in place
 * to { status: "ready", raw, baseCorners, baseY, lengthLabel } once the
 * track resolves, or { status: "error", error } on failure.
 *
 * World-space points are cached (not pre-projected) so drawHologram() can
 * apply a fresh Y-axis rotation + isometric projection every frame, making
 * the hologram spin without re-resolving or re-decimating the track.
 */
export function getPreview(def) {
  if (!def) return null;
  const id = def.id || def.name || "unknown";
  const cached = _cache.get(id);
  if (cached) return cached;

  const entry = { status: "loading" };
  _cache.set(id, entry);
  resolveLevelTrack(def).then((track) => {
    const decimated = decimate(track.samples, MAX_POINTS);
    const raw = decimated.map((s) => ({
      x: s.x, y: s.y, z: s.z,
      lx: s.x + s.px * s.hw, lz: s.z + s.pz * s.hw,
      rx: s.x - s.px * s.hw, rz: s.z - s.pz * s.hw,
    }));
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of track.samples) {
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      if (s.z < minZ) minZ = s.z;
      if (s.z > maxZ) maxZ = s.z;
    }
    entry.status = "ready";
    entry.raw = raw;
    entry.baseCorners = [
      { x: minX, z: minZ },
      { x: maxX, z: minZ },
      { x: maxX, z: maxZ },
      { x: minX, z: maxZ },
    ];
    entry.baseY = track.minY;
    entry.lengthLabel = Math.round(track.totalLen) + "M";
  }).catch((err) => {
    entry.status = "error";
    entry.error = err;
  });
  return entry;
}

function drawScanning(rd, x, y, w, h, frame) {
  const cx = x + w / 2, cy = y + h / 2;
  const r = Math.max(6, Math.min(w, h) * 0.3);
  drawCircle(rd, cx, cy, r, HOLO, false, 90);
  drawCircle(rd, cx, cy, r * 0.55, HOLO, false, 60);
  const ang = (frame * 0.12) % (Math.PI * 2);
  drawLine(rd, cx, cy, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, HOLO_HOT, 220);
  if (frame & 16) drawText(rd, "SCANNING", cx - 20, y + h - 10, HOLO, 1);
}

function drawNoSignal(rd, x, y, w, h) {
  drawText(rd, "NO SIGNAL", x + w / 2 - 22, y + h / 2 - 3, NO_SIG, 1);
}

/**
 * Draw the hologram inside the (x, y, w, h) rect. `entry` comes from
 * getPreview(); `frame` drives the Y-axis spin, scan sweep, and flicker.
 */
export function drawHologram(rd, entry, x, y, w, h, frame) {
  if (!entry || entry.status === "loading") return drawScanning(rd, x, y, w, h, frame);
  if (entry.status === "error") return drawNoSignal(rd, x, y, w, h);

  const f = frame || 0;
  const ang = f * ROT_SPEED;
  const cosA = Math.cos(ang), sinA = Math.sin(ang);
  const project = (wx, wz, wy) => {
    const r = rotateXZ(wx, wz, cosA, sinA);
    return isoXY(r.x, wy, r.z);
  };

  const pts = entry.raw.map((s) => ({
    c: project(s.x, s.z, s.y),
    L: project(s.lx, s.lz, s.y),
    R: project(s.rx, s.rz, s.y),
  }));
  const base = entry.baseCorners.map((b) => project(b.x, b.z, entry.baseY));
  const boundsIso = computeBoundsIso(pts, base);

  const marginX = w * 0.1, marginY = h * 0.12;
  const spanX = Math.max(1, boundsIso.maxIx - boundsIso.minIx);
  const spanY = Math.max(1, boundsIso.maxIy - boundsIso.minIy);
  const scale = Math.min((w - marginX * 2) / spanX, (h - marginY * 2) / spanY);
  const midIx = (boundsIso.minIx + boundsIso.maxIx) / 2;
  const midIy = (boundsIso.minIy + boundsIso.maxIy) / 2;
  const cx = x + w / 2, cy = y + h / 2;
  const toScreen = (p) => ({ sx: cx + (p.ix - midIx) * scale, sy: cy + (p.iy - midIy) * scale });

  // Platform base (ground-plane extents of the track), rotating along with
  // the rest of the hologram over the static globe drawn underneath it.
  for (let i = 0; i < base.length; i++) {
    const a = toScreen(base[i]), b = toScreen(base[(i + 1) % base.length]);
    drawLine(rd, a.sx, a.sy, b.sx, b.sy, HOLO, 90);
  }

  const n = pts.length;
  const flicker = 230 + ((Math.sin(frame * 0.35) * 12) | 0);

  // Glow pass under the centerline.
  for (let i = 0; i < n; i++) {
    const a = toScreen(pts[i].c), b = toScreen(pts[(i + 1) % n].c);
    drawThickLine(rd, a.sx, a.sy, b.sx, b.sy, HOLO, 3, 50);
  }

  // Edge rails + rungs + crisp centerline on top.
  for (let i = 0; i < n; i++) {
    const cur = pts[i], nxt = pts[(i + 1) % n];
    const aL = toScreen(cur.L), bL = toScreen(nxt.L);
    const aR = toScreen(cur.R), bR = toScreen(nxt.R);
    drawLine(rd, aL.sx, aL.sy, bL.sx, bL.sy, HOLO, 130);
    drawLine(rd, aR.sx, aR.sy, bR.sx, bR.sy, HOLO, 130);
    if (i % 6 === 0) drawLine(rd, aL.sx, aL.sy, aR.sx, aR.sy, HOLO, 70);
    const aC = toScreen(cur.c), bC = toScreen(nxt.c);
    drawLine(rd, aC.sx, aC.sy, bC.sx, bC.sy, HOLO, flicker);
  }

  // Start/finish marker.
  const s0 = toScreen(pts[0].c);
  drawCircle(rd, s0.sx, s0.sy, 2, HOLO_HOT, true);

  // Vertical scan sweep.
  const t = (frame % 90) / 90;
  drawRect(rd, x, y + t * h, w, 2, HOLO_HOT, true, 90);

  // Length readout.
  if (entry.lengthLabel) {
    drawText(rd, entry.lengthLabel, x + w - entry.lengthLabel.length * 5 - 2, y + h - 9, HOLO_HOT, 1);
  }
}

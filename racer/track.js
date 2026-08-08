/**
 * racer/track.js — Track spline definition + spatial queries.
 *
 * A track is a closed Catmull-Rom loop sampled into evenly-ish spaced
 * samples. Each sample carries: center position, forward tangent (XZ),
 * perpendicular (XZ, "right" side), half-width, cumulative arc distance,
 * and flags (ramp / rampLip / gap).
 *
 * Physics (vehicle.js) and rendering (trackrender.js) both consume the
 * same sample array, so the collision boundary is exactly the rendered road.
 */

// ---- Control points ---------------------------------------------------------
// Ring layout (never self-intersects): angle around origin + radius + height.
// Pulled-in radii create sweepers and one hairpin; y creates a hill section.
const CP = [
  //  angleDeg, radius, y
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

const HALF_WIDTH   = 7.0;   // road half-width (world units)
const SAMPLE_SPACE = 3.2;   // target spacing between samples

// Radial control points and road metrics can be overridden per level via
// buildTrack({ cp, halfWidth, sampleSpace }). Without an override the
// defaults below (the AHURA RING) are used, so existing callers are unchanged.
const DEFAULT_DEF = { cp: CP, halfWidth: HALF_WIDTH, sampleSpace: SAMPLE_SPACE };

// Ramp/gap anchor: a point on the west straight (angle ≈ 190°, r ≈ 119)
const RAMP_ANCHOR_X = 119 * Math.cos((190 * Math.PI) / 180);
const RAMP_ANCHOR_Z = 119 * Math.sin((190 * Math.PI) / 180);
const RAMP_RISE_SAMPLES = 9;   // samples of upslope before the lip
const RAMP_HEIGHT       = 2.6; // lip height above base road
const RAMP_FALL_SAMPLES = 4;   // samples of steep drop-off after the lip (no gap —
                               // the road falls away fast so the car still launches)

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return (
    0.5 * ((2 * p1) + (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

export function buildTrack(def) {
  const cfg = def || DEFAULT_DEF;
  const cp = cfg.cp || CP;
  const halfWidth = cfg.halfWidth || HALF_WIDTH;
  const sampleSpace = cfg.sampleSpace || SAMPLE_SPACE;

  // Control points → world coords
  const pts = cp.map(([a, r, y]) => {
    const rad = (a * Math.PI) / 180;
    return { x: r * Math.cos(rad), y, z: r * Math.sin(rad) };
  });
  const n = pts.length;

  // ---- Sample the closed loop ----------------------------------------------
  const samples = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const chord = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const steps = Math.max(4, Math.round(chord / sampleSpace));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      samples.push({
        x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
        y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
        z: catmullRom(p0.z, p1.z, p2.z, p3.z, t),
        hw: halfWidth,
        ramp: false, rampLip: false, gap: false,
      });
    }
  }
  const count = samples.length;

  // ---- Tangents, perpendiculars, arc length ---------------------------------
  let dist = 0;
  for (let i = 0; i < count; i++) {
    const prev = samples[(i - 1 + count) % count];
    const next = samples[(i + 1) % count];
    const cur  = samples[i];
    let fx = next.x - prev.x;
    let fz = next.z - prev.z;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl; fz /= fl;
    cur.fx = fx; cur.fz = fz;
    cur.px = -fz; cur.pz = fx;      // "right" perpendicular (f × up)
    if (i > 0) {
      const pp = samples[i - 1];
      dist += Math.hypot(cur.x - pp.x, cur.z - pp.z);
    }
    cur.dist = dist;
    cur.segLen = 0; // filled below
  }
  for (let i = 0; i < count; i++) {
    const next = samples[(i + 1) % count];
    const cur = samples[i];
    cur.segLen = Math.hypot(next.x - cur.x, next.z - cur.z) || 1;
  }

  // ---- Ramp + gap on the west straight --------------------------------------
  let lipIdx = 0, bd = Infinity;
  for (let i = 0; i < count; i++) {
    const dx = samples[i].x - RAMP_ANCHOR_X;
    const dz = samples[i].z - RAMP_ANCHOR_Z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; lipIdx = i; }
  }
  for (let k = 0; k <= RAMP_RISE_SAMPLES; k++) {
    const i = (lipIdx - RAMP_RISE_SAMPLES + k + count) % count;
    const t = k / RAMP_RISE_SAMPLES;               // 0..1 up the ramp
    samples[i].y += RAMP_HEIGHT * t * t;           // ease-in rise
    samples[i].ramp = true;
  }
  samples[lipIdx].rampLip = true;
  // Steep drop-off after the lip back to base road level — continuous road,
  // but it falls away faster than the car's flight arc, so jumps still happen.
  for (let k = 1; k < RAMP_FALL_SAMPLES; k++) {
    const i = (lipIdx + k) % count;
    const t = k / RAMP_FALL_SAMPLES;               // 0..1 down the back side
    samples[i].y += RAMP_HEIGHT * (1 - t) * (1 - t); // ease-out drop
    samples[i].ramp = true;
  }

  let minY = Infinity;
  for (const s of samples) if (s.y < minY) minY = s.y;

  return {
    samples,
    count,
    totalLen: dist,
    minY,
    lipIdx,
    spawnIdx: 0,
  };
}

// ---- Nearest-sample query ----------------------------------------------------
// hint: last known sample index (searches a small wrapped window around it).
// Returns { idx, groundY, lat, fx, fz, px, pz, hw, gap, rampLip, distSq }.
const SEARCH_WINDOW = 26;

export function queryTrack(track, x, z, hint) {
  const s = track.samples;
  const n = track.count;
  let best = -1, bd = Infinity;

  const test = (i) => {
    const dx = x - s[i].x, dz = z - s[i].z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  };

  if (hint != null && hint >= 0) {
    for (let k = -SEARCH_WINDOW; k <= SEARCH_WINDOW; k++) test((hint + k + n) % n);
    // Hint window missed the track entirely → full rescan
    if (bd > 90 * 90) { bd = Infinity; best = -1; }
  }
  if (best < 0) for (let i = 0; i < n; i++) test(i);

  const a = s[best];
  const b = s[(best + 1) % n];
  // Project onto segment a→b for smooth ground height between samples
  let t = ((x - a.x) * a.fx + (z - a.z) * a.fz) / a.segLen;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a.x + (b.x - a.x) * t;
  const cy = a.y + (b.y - a.y) * t;
  const cz = a.z + (b.z - a.z) * t;
  const lat = (x - cx) * a.px + (z - cz) * a.pz;

  return {
    idx: best,
    t,
    groundY: cy,
    lat,
    fx: a.fx, fz: a.fz,
    px: a.px, pz: a.pz,
    hw: a.hw,
    gap: a.gap || (t > 0.5 && b.gap),
    rampLip: a.rampLip,
    distSq: bd,
  };
}

/**
 * racer/track.js — Track spline definition + spatial queries.
 *
 * A track is a closed Catmull-Rom loop sampled into evenly-ish spaced
 * samples. Each sample carries: center position, forward tangent (XZ),
 * perpendicular (XZ, "right" side), half-width, cumulative arc distance,
 * optional bank, and flags (ramp / rampLip / gap).
 *
 * Physics (vehicle.js) and rendering (trackrender.js) both consume the
 * same sample array, so the collision boundary is exactly the rendered road.
 *
 * Control points may be polar tuples [angleDeg, radius, y] (AHURA RING) or
 * XYZ objects {x,y,z, bank?, hw?} from the spline editor. The AHURA west
 * straight jump ramp is applied only when applyDefaultRamp is true.
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
// buildTrack({ cp, halfWidth, sampleSpace, applyDefaultRamp }).
const DEFAULT_DEF = { cp: CP, halfWidth: HALF_WIDTH, sampleSpace: SAMPLE_SPACE };

// Ramp/gap anchor: a point on the west straight (angle ≈ 190°, r ≈ 119)
const RAMP_ANCHOR_X = 119 * Math.cos((190 * Math.PI) / 180);
const RAMP_ANCHOR_Z = 119 * Math.sin((190 * Math.PI) / 180);
const RAMP_RISE_SAMPLES = 9;   // samples of upslope before the lip
const RAMP_HEIGHT       = 2.6; // lip height above base road
const RAMP_FALL_SAMPLES = 4;   // samples of steep drop-off after the lip

// Off-road driving surface: the rendered ground plain under everything sits at
// track.minY - OFFROAD_DROP (see trackrender.js), so physics rides the SAME
// plane — the car lands on the grass/dirt instead of falling forever.
const OFFROAD_DROP = 0.4;

// Off-road transition ramp: between the road edge (the wall base at hw+RUMBLE_W)
// and the flat floor plane the grass slopes smoothly down (smoothstep) over
// track.transW, so drivers who leave the road can drive back up onto the deck.
// The ramp length adapts to the track's elevation range so the slope never
// exceeds TRANS_SLOPE (vertical drop per horizontal unit) — steep enough to
// read as a hillside, shallow enough to climb and to not launch the car off it.
export const RUMBLE_W = 0.9;   // wall base / grass inner edge sits at hw+RUMBLE_W
const TRANS_MIN_W = 16;        // minimum ramp width (matches the grass apron)
const TRANS_SLOPE = 0.35;      // max ramp drop per horizontal unit (~19°)

// Wall solidity runs. Walls are randomly solid/non-solid so driving off-course
// is possible; non-solid stretches carry destructible tire stacks instead.
const WALL_SOLID_CHANCE = 0.7; // probability a new run is solid
const WALL_RUN_MIN = 3;        // min samples in a run
const WALL_RUN_LEN = 6;        // random extra samples in a run (0..5)
const WALL_SEED_DEFAULT = 20260808;

/** Deterministic PRNG (mulberry32) so wall patterns are stable per seed. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return (
    0.5 * ((2 * p1) + (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Normalize a control-point list into {x,y,z,bank,hw} world points. */
function normalizeControlPoints(cp, defaultHw) {
  if (!cp || !cp.length) return [];
  const first = cp[0];
  // XYZ object form (spline editor / trackload)
  if (first && typeof first === "object" && !Array.isArray(first) &&
      ("x" in first || "z" in first)) {
    return cp.map((p) => ({
      x: +p.x || 0,
      y: +p.y || 0,
      z: +p.z || 0,
      bank: +p.bank || 0,
      hw: p.hw != null && p.hw > 0 ? +p.hw : defaultHw,
    }));
  }
  // Polar [angleDeg, radius, y] form (AHURA RING)
  return cp.map((row) => {
    const a = row[0], r = row[1], y = row[2];
    const rad = (a * Math.PI) / 180;
    return {
      x: r * Math.cos(rad),
      y: y || 0,
      z: r * Math.sin(rad),
      bank: 0,
      hw: defaultHw,
    };
  });
}

export function buildTrack(def) {
  const cfg = def || DEFAULT_DEF;
  const halfWidth = cfg.halfWidth || HALF_WIDTH;
  const sampleSpace = cfg.sampleSpace || SAMPLE_SPACE;
  const applyDefaultRamp = !!cfg.applyDefaultRamp;
  const pts = normalizeControlPoints(cfg.cp || CP, halfWidth);
  const n = pts.length;
  if (n < 3) {
    throw new Error("buildTrack: need at least 3 control points");
  }

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
        hw: lerp(p1.hw, p2.hw, t),
        bank: lerp(p1.bank, p2.bank, t),
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

  // ---- Optional AHURA west-straight ramp (gated) ----------------------------
  let lipIdx = 0;
  if (applyDefaultRamp) {
    let bd = Infinity;
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
  }

  let minY = Infinity, maxEdge = -Infinity;
  for (const s of samples) {
    if (s.y < minY) minY = s.y;
    const lift = Math.abs(Math.sin((s.bank * Math.PI) / 180)) * (s.hw + RUMBLE_W);
    const e = s.y + lift;   // highest deck edge (bank lifts the outer edge)
    if (e > maxEdge) maxEdge = e;
  }

  // ---- Wall solidity --------------------------------------------------------
  // Run-length flags so non-solid stretches are actually drivable gaps (a few
  // samples wide), not single-sample noise. Ramps and gaps are always open
  // (no wall / can't block a jump). Default "random"; "all" restores the old
  // always-solid behavior. Seeded → deterministic per track.
  const wallMode = cfg.wallSolid === "all" ? "all" : "random";
  const wallSeed = cfg.wallSolidSeed != null ? cfg.wallSolidSeed : WALL_SEED_DEFAULT;
  if (wallMode === "all") {
    for (const s of samples) s.wallSolid = true;
  } else {
    const rng = mulberry32(wallSeed);
    let curSolid = rng() < WALL_SOLID_CHANCE;
    let runLeft = 0;
    for (let i = 0; i < count; i++) {
      const s = samples[i];
      if (s.ramp || s.gap) { s.wallSolid = false; continue; }
      if (runLeft <= 0) {
        curSolid = rng() < WALL_SOLID_CHANCE;
        runLeft = WALL_RUN_MIN + ((rng() * WALL_RUN_LEN) | 0);
      }
      runLeft--;
      s.wallSolid = curSolid;
    }
  }

  return {
    samples,
    count,
    totalLen: dist,
    minY,
    offroadY: minY - OFFROAD_DROP,
    transW: Math.max(TRANS_MIN_W, (maxEdge - (minY - OFFROAD_DROP)) / TRANS_SLOPE),
    lipIdx: applyDefaultRamp ? lipIdx : 0,
    spawnIdx: 0,
  };
}

// ---- Nearest-sample query ----------------------------------------------------
// hint: last known sample index (searches a small wrapped window around it).
// Returns { idx, t, groundY, lat, bank, fx, fz, px, pz, hw, gap, rampLip,
//           wallSolid, distSq }. groundY follows the banked deck: center height
// plus lerp(sin(bank)) * lat, which lands exactly on the editor's bilinear
// mesh (samples carry bank in DEGREES). wallSolid is true only when both
// samples of the segment have solid walls (matches the rendered wall).
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

  // Banked ground height. Lerp the SINE of each sample's bank (not sin of the
  // lerped angle) so the query rides the editor's bilinear deck exactly.
  const bankA = a.bank || 0, bankB = b.bank || 0;
  const bankRad = (bankA * Math.PI) / 180;
  const sbA = Math.sin(bankRad), sbB = Math.sin((bankB * Math.PI) / 180);
  const sb = sbA + (sbB - sbA) * t;

  return {
    idx: best,
    t,
    groundY: cy + sb * lat,
    lat,
    bank: bankA + (bankB - bankA) * t,   // degrees at the query point
    fx: a.fx, fz: a.fz,
    px: a.px, pz: a.pz,
    hw: a.hw,
    gap: a.gap || (t > 0.5 && b.gap),
    rampLip: a.rampLip,
    wallSolid: a.wallSolid !== false && b.wallSolid !== false, // matches the rendered wall (both samples solid)
    distSq: bd,
  };
}

/**
 * Ground height for a query point, riding the SAME surface the renderer draws:
 * the banked deck plane within the road band (|lat| ≤ hw+RUMBLE_W), then the
 * grass ramp smoothly sloping down to the flat off-road floor plane
 * (track.offroadY) over track.transW, then the flat floor beyond.
 *
 * The deck at the ramp start is the deck plane evaluated at the wall base
 * (q.groundY − sin(bank)·(|lat| − edge)), matching the renderer's ramp inner
 * edge on banked sections. Returns a height; callers must gate on q.gap
 * themselves (a gap has no ground).
 */
export function groundHeightAt(track, q) {
  const edge = q.hw + RUMBLE_W;
  const absLat = Math.abs(q.lat);
  if (absLat <= edge) return q.groundY;
  const end = edge + track.transW;
  if (absLat >= end) return track.offroadY;
  const sb = Math.sin((q.bank * Math.PI) / 180);
  const deckAtEdge = q.groundY - sb * (absLat - edge);
  const u = (absLat - edge) / track.transW;
  const su = u * u * (3 - 2 * u);   // smoothstep — flat at both ends
  return deckAtEdge + (track.offroadY - deckAtEdge) * su;
}

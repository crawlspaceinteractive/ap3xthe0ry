/**
 * tools/ribbon-smoke.js — Node smoke test for banked-ribbon parity.
 *
 * Verifies that the racer's renderer helpers (edgePt / sampleUp) match the
 * spline-editor's ribbonCorners / edgeCorner formula 1:1, and that
 * queryTrack's groundY rides the banked deck exactly (bilinear, lerp-of-sin).
 *
 * Run: node tools/ribbon-smoke.js  (exits non-zero on failure)
 */
import { buildTrack, queryTrack } from "../racer/track.js";
import { edgePt, sampleUp } from "../racer/trackrender.js";

const DEG = Math.PI / 180;
let failures = 0;

function check(name, got, want, eps) {
  if (typeof got === "object" && got !== null) {
    const ok = Math.abs(got.x - want.x) <= eps && Math.abs(got.y - want.y) <= eps && Math.abs(got.z - want.z) <= eps;
    if (ok) {
      console.log(`  ok   ${name}`);
    } else {
      failures++;
      console.log(`  FAIL ${name}: got (${got.x}, ${got.y}, ${got.z}) want (${want.x}, ${want.y}, ${want.z})`);
    }
    return;
  }
  if (Math.abs(got - want) <= eps) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}: got ${got} want ${want} (±${eps})`);
  }
}

/** Editor truth (tools/spline-editor.html) — edgeCorner(s, side, f). */
function editorCorner(s, side, f) {
  const b = (s.bank || 0) * DEG;
  const cb = Math.cos(b), sb = Math.sin(b);
  const lat = s.hw * f;
  return { x: s.x + s.px * cb * side * lat, y: s.y + sb * side * lat, z: s.z + s.pz * cb * side * lat };
}

// ---- Banked test track: closed loop, one control point banked -------------------
const BANKED_CP = [
  { x: 0, y: 0, z: 0, bank: 0 },
  { x: 40, y: 2, z: 0, bank: 0 },
  { x: 40, y: 6, z: 40, bank: 15 },
  { x: 0, y: 8, z: 40, bank: 0 },
  { x: -40, y: 6, z: 40, bank: 0 },
  { x: -40, y: 2, z: 0, bank: 0 },
];
const track = buildTrack({ cp: BANKED_CP, halfWidth: 7, sampleSpace: 2.0 });
const bankedSamples = track.samples.filter((s) => Math.abs(s.bank) > 0.1);
console.log(`[1] edgePt vs editor edgeCorner (f = 0.62 / 0.9 / 1.0)`);
if (!bankedSamples.length) {
  failures++;
  console.log("  FAIL no banked samples produced");
} else {
  const s = bankedSamples[0];
  for (const f of [0.62, 0.9, 1.0]) {
    for (const side of [-1, 1]) {
      check(`bank ${s.bank}° side ${side} f=${f}`, edgePt(s, side, s.hw * f), editorCorner(s, side, f), 1e-9);
    }
  }
}

console.log(`[2] sampleUp — bank 0 → (0,1,0); banked → ⊥ deck, up.y == cos(bank)`);
const flat = track.samples.find((s) => !s.bank);
if (flat) check("flat sampleUp", sampleUp(flat), { x: 0, y: 1, z: 0 }, 1e-9);
const s2 = bankedSamples[0];
{
  const b = s2.bank * DEG;
  const up = sampleUp(s2);
  check("banked up.y == cos(bank)", up.y, Math.cos(b), 1e-9);
  // perpendicular to banked lateral axis (px·cb, sb, pz·cb)
  const latDir = { x: s2.px * Math.cos(b), y: Math.sin(b), z: s2.pz * Math.cos(b) };
  const dot = up.x * latDir.x + up.y * latDir.y + up.z * latDir.z;
  check("banked up ⊥ deck lateral (dot 0)", dot, 0, 1e-9);
}

console.log(`[3] queryTrack groundY on banked deck`);

// At horizontal lat = ±hw (query point = sample center + perpendicular * hw):
// groundY must equal the editor corner height s.y ± sin(bank)·hw.
{
  const s = bankedSamples[0];
  const sb = Math.sin(s.bank * DEG);
  for (const side of [-1, 1]) {
    const q = queryTrack(track, s.x + s.px * s.hw * side, s.z + s.pz * s.hw * side);
    const want = s.y + sb * s.hw * side;
    check(`lat≈+${side * s.hw} groundY ≈ editor corner`, q.groundY, want, 1e-4);
  }
  // Centerline → the sample's own y
  const qc = queryTrack(track, s.x, s.z);
  check("centerline groundY == sample y", qc.groundY, s.y, 1e-4);
  check("bank returned in degrees", qc.bank, s.bank, 1e-9);
}

// Mid-segment bilinear check: query at an off-sample point in the bank
// transition, then reconstruct the deck from the FOUR rendered corner heights
// (a/b × L/R) at the query's own (t, lat). If physics rides the rendered deck,
// q.groundY must equal that bilinear height — regardless of which sample the
// nearest-sample scan lands on.
{
  const s = bankedSamples[0];
  const qm = queryTrack(track, s.x + s.px * s.hw * 0.6, s.z + s.pz * s.hw * 0.6);
  const a = track.samples[qm.idx];
  const b = track.samples[(qm.idx + 1) % track.count];
  const ba = (a.bank || 0) * DEG, bb = (b.bank || 0) * DEG;
  const t = qm.t, lat = qm.lat, hw = qm.hw;
  const aL = a.y - Math.sin(ba) * hw, aR = a.y + Math.sin(ba) * hw;
  const bL = b.y - Math.sin(bb) * hw, bR = b.y + Math.sin(bb) * hw;
  const leftAtT = aL + (bL - aL) * t;
  const rightAtT = aR + (bR - aR) * t;
  const u = (lat + hw) / (2 * hw);   // 0 = left edge, 1 = right edge
  const deck = leftAtT + (rightAtT - leftAtT) * u;
  check(`mid-seg groundY == bilinear deck (q.t=${t.toFixed(3)}, lat=${lat.toFixed(3)})`, qm.groundY, deck, 1e-3);
}
{
  // True off-sample query on a STRAIGHT banked segment: two adjacent samples
  // with bank 15→0, query 50% along with a lateral offset. Straight geometry
  // guarantees the hint search resolves to the a→b segment with t≈0.5, so the
  // returned groundY must equal the bilinear deck built from the corner heights.
  const bankStraight = buildTrack({ cp: [
    { x: 0, y: 0, z: 0, bank: 0 }, { x: 40, y: 0, z: 0, bank: 15 },
    { x: 80, y: 0, z: 0, bank: 0 }, { x: 120, y: 0, z: 0, bank: 0 },
    { x: 160, y: 0, z: 0, bank: 0 }, { x: 200, y: 0, z: 0, bank: 0 },
    { x: 240, y: 0, z: 0, bank: 0 }, { x: 280, y: 0, z: 0, bank: 0 },
    { x: 320, y: 0, z: 0, bank: 0 },
  ], halfWidth: 7, sampleSpace: 1.5 });
  // Pick a sample on the banked straight well away from the loop's closing
  // segment near the origin (which would win the nearest-sample scan).
  let aIdx = -1;
  for (let i = 0; i < bankStraight.count; i++) {
    const s = bankStraight.samples[i];
    const nx = bankStraight.samples[(i + 1) % bankStraight.count].x;
    if (Math.abs(s.bank) > 10 && nx > s.x && Math.abs(nx - s.x) < 2.5) { aIdx = i; break; }
  }
  const a = bankStraight.samples[aIdx];
  const b = bankStraight.samples[(aIdx + 1) % bankStraight.count];
  const p = {
    x: a.x + (b.x - a.x) * 0.5 + a.px * a.hw * 0.4,
    z: a.z + (b.z - a.z) * 0.5 + a.pz * a.hw * 0.4,
  };
  const q2 = queryTrack(bankStraight, p.x, p.z, aIdx);
  const a2 = bankStraight.samples[q2.idx];
  const b2 = bankStraight.samples[(q2.idx + 1) % bankStraight.count];
  const ba2 = (a2.bank || 0) * DEG, bb2 = (b2.bank || 0) * DEG;
  const hw2 = q2.hw, t2 = q2.t, lat2 = q2.lat;
  const aL2 = a2.y - Math.sin(ba2) * hw2, aR2 = a2.y + Math.sin(ba2) * hw2;
  const bL2 = b2.y - Math.sin(bb2) * hw2, bR2 = b2.y + Math.sin(bb2) * hw2;
  const left2 = aL2 + (bL2 - aL2) * t2, right2 = aR2 + (bR2 - aR2) * t2;
  const deck2 = left2 + (right2 - left2) * ((lat2 + hw2) / (2 * hw2));
  check(`straight-seg groundY == bilinear deck (q.t=${t2.toFixed(3)}, lat=${lat2.toFixed(3)})`, q2.groundY, deck2, 1e-3);
  check("straight-seg t is genuinely mid-segment", t2 > 0.4 && t2 < 0.6, true, 0);
  // Height must actually include the camber (edge difference on a 15°→0 bank)
  check("straight-seg camber nonzero (L vs R corner)", (bR2 - bL2) / 2 > 0.5, true, 0);
}

console.log(`[4] flat regression — bank-0 track: groundY == cy, edgePt.y == s.y`);
{
  const flatTrack = buildTrack({ cp: [
    { x: 0, y: 0, z: 0 }, { x: 60, y: 0, z: 0 }, { x: 60, y: 0, z: 60 }, { x: 0, y: 0, z: 60 },
  ], halfWidth: 7, sampleSpace: 2.0 });
  let allFlat = true;
  for (const s of flatTrack.samples) {
    if (s.bank !== 0) allFlat = false;
    const q = queryTrack(flatTrack, s.x + s.px * 5, s.z + s.pz * 5);
    if (Math.abs(q.groundY - s.y) > 1e-6) allFlat = false;
    if (Math.abs(edgePt(s, 1, s.hw).y - s.y) > 1e-9) allFlat = false;
    const up = sampleUp(s);
    if (Math.abs(up.x) > 1e-9 || Math.abs(up.y - 1) > 1e-9 || Math.abs(up.z) > 1e-9) allFlat = false;
  }
  check("flat track: all samples bank 0, groundY==y, edgePt.y==y, up=(0,1,0)", allFlat, true, 0);
}

console.log(failures ? `\n${failures} failure(s)` : "\nAll ribbon-parity checks passed.");
process.exit(failures ? 1 : 0);

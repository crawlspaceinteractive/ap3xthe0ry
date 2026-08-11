/**
 * racer/laptimer.js — Pure lap timing for the arcade racer.
 *
 * Accumulates a per-lap clock at the fixed simulation rate and detects
 * start/finish crossings by tracking arc distance along the closed track
 * spline: moving forward, distance wraps high → low at the seam exactly once
 * per lap. A minimum-lap guard stops seam-wiggle double counts.
 *
 * Lap HONOR system: control points on the spline must be visited in forward
 * order before a finish crossing scores a lap. Gates are discs (track.gates)
 * centered on the spline at each control point; the car advances `nextGate`
 * only while it is physically inside the next disc. A LITTLE GRACE: a lap
 * needs the MAJORITY of gates (≥ half, i.e. the player may skip every other
 * control point) rather than all of them, so honest drivers aren't punished
 * for one missed corner. Reversing over the finish line (or cutting the whole
 * course) never credits a lap. racergame calls resetLapTimer at race start
 * (fresh gates) and unarmLapTimer at respawn teleports (gates already passed
 * stay passed). No DOM — unit-testable under Node.
 */
import { queryTrack } from "./track.js";

const MIN_LAP_STEPS = 240;   // ~4s at 60Hz — floor below any real lap

export function createLapTimer() {
  return {
    lap: 1,          // 1-based current lap
    curMs: 0,        // elapsed ms in the current lap
    bestMs: 0,       // fastest completed lap (0 = none yet)
    nextGate: 0,     // index of the next control-point gate to pass this lap
    dist: 0,         // arc distance (world units) covered along the spline
                      // THIS lap. Combine with `lap` for true race-progress
                      // ordering (racergame.js: lap*totalLen + dist) — unlike
                      // curMs, which just ticks with wall-clock time and is
                      // identical for every car on every frame, so it can
                      // never actually distinguish who is ahead.
    _prevDist: -1,   // last sampled arc distance (sentinel = unarmed)
    _raceMs: 0,      // clock backing curMs
    _steps: 0,
    _lastLapStep: -1,
  };
}

// Steps the timer. Returns the nearest-sample index so the caller can feed it
// back as the query hint next frame.
export function stepLapTimer(lt, track, x, z, hint, dtMs) {
  lt._steps++;
  const q = queryTrack(track, x, z, hint);
  const s = track.samples[q.idx];
  const dist = s.dist + q.t * s.segLen;
  lt.dist = dist;   // exposed for race-rank ordering (see the `dist` field doc)
  const armed = lt._lastLapStep < 0 || lt._steps - lt._lastLapStep > MIN_LAP_STEPS;
  const crossed = armed && lt._prevDist >= 0 && lt._prevDist - dist > track.totalLen * 0.5;
  lt._prevDist = dist;

  // ---- Control-point gates ---------------------------------------------------
  // Advance through every gate the car is inside right now (a while-loop so
  // near-identical gate discs can be threaded in one step). Only the NEXT
  // gate is ever considered, so gates must be collected in order — reversing
  // or corner-cutting never skips ahead.
  const gates = track.gates;
  if (gates && lt.nextGate < gates.length) {
    while (lt.nextGate < gates.length) {
      const g = gates[lt.nextGate];
      const dx = x - g.x, dz = z - g.z;
      if (dx * dx + dz * dz > g.r * g.r) break;
      lt.nextGate++;
    }
  }
  const honorOk = !gates || lt.nextGate * 2 >= gates.length;

  // The step that carries the car back to the start line is part of the lap
  // it completes, so the clock ticks before the crossing is recorded.
  lt._raceMs += dtMs;
  if (crossed && honorOk) {
    if (lt.bestMs === 0 || lt._raceMs < lt.bestMs) lt.bestMs = lt._raceMs;
    lt.lap++;
    lt._lastLapStep = lt._steps;
    lt._raceMs = 0;
    lt.nextGate = 0;
  }
  lt.curMs = lt._raceMs;
  return q.idx;
}

// Full reset for a fresh race: unarms crossing detection AND clears gate
// progress (the car starts at the line, gates before it). Keeps bestMs (the
// fastest lap survives respawns).
export function resetLapTimer(lt) {
  lt._prevDist = -1;
  lt._raceMs = 0;
  lt.curMs = 0;
  lt._steps = 0;
  lt._lastLapStep = -1;
  lt.nextGate = 0;
  lt.dist = 0;
}

// Respawn unarm: the position teleport must not register as a crossing, but
// control points already collected stay collected — the car respawns on-track
// near where it left, so gate progress remains valid.
export function unarmLapTimer(lt) {
  lt._prevDist = -1;
  lt._raceMs = 0;
  lt.curMs = 0;
  lt._steps = 0;
  lt._lastLapStep = -1;
}

// "M:SS.CC" — stable 7-char width so the HUD never reflows.
export function formatLapTime(ms) {
  const c = Math.floor((ms % 1000) / 10);
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 60000);
  return `${m}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

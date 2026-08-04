/**
 * racer/laptimer.js — Pure lap timing for the arcade racer.
 *
 * Accumulates a per-lap clock at the fixed simulation rate and detects
 * start/finish crossings by tracking arc distance along the closed track
 * spline: moving forward, distance wraps high → low at the seam exactly once
 * per lap. A minimum-lap guard stops seam-wiggle double counts, and
 * racergame calls resetLapTimer at race start + respawn teleports so position
 * jumps never register as laps. No DOM — unit-testable under Node.
 */
import { queryTrack } from "./track.js";

const MIN_LAP_STEPS = 240;   // ~4s at 60Hz — floor below any real lap

export function createLapTimer() {
  return {
    lap: 1,          // 1-based current lap
    curMs: 0,        // elapsed ms in the current lap
    bestMs: 0,       // fastest completed lap (0 = none yet)
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
  const armed = lt._lastLapStep < 0 || lt._steps - lt._lastLapStep > MIN_LAP_STEPS;
  const crossed = armed && lt._prevDist >= 0 && lt._prevDist - dist > track.totalLen * 0.5;
  lt._prevDist = dist;

  // The step that carries the car back to the start line is part of the lap
  // it completes, so the clock ticks before the crossing is recorded.
  lt._raceMs += dtMs;
  if (crossed) {
    if (lt.bestMs === 0 || lt._raceMs < lt.bestMs) lt.bestMs = lt._raceMs;
    lt.lap++;
    lt._lastLapStep = lt._steps;
    lt._raceMs = 0;
  }
  lt.curMs = lt._raceMs;
  return q.idx;
}

// Resets the current-lap clock and un-arms crossing detection (used on race
// start and at respawn teleports, where the position jump must not count).
// Keeps bestMs (the fastest lap survives respawns).
export function resetLapTimer(lt) {
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

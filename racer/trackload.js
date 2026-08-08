/**
 * racer/trackload.js — Load spline-editor track JSON into a runtime track.
 *
 * Called only via levels.js resolveLevelTrack (the level list). Editor
 * exports use kind "spline-track" with XYZ controlPoints. objects[] and
 * procgen scenery are ignored here (step 2+).
 */
import { buildTrack } from "./track.js";

const MIN_POINTS = 3;

/**
 * Validate spline-editor JSON and return a buildTrack def (no default ramp).
 * @param {object} data
 * @returns {{ cp: object[], halfWidth: number, sampleSpace: number, name?: string }}
 */
export function parseSplineTrack(data) {
  if (!data || typeof data !== "object") {
    throw new Error("parseSplineTrack: expected an object");
  }
  if (data.kind != null && data.kind !== "spline-track") {
    throw new Error(`parseSplineTrack: unsupported kind "${data.kind}"`);
  }
  const cps = data.controlPoints;
  if (!Array.isArray(cps) || cps.length < MIN_POINTS) {
    throw new Error(`parseSplineTrack: need at least ${MIN_POINTS} controlPoints`);
  }
  if (data.closed === false) {
    throw new Error("parseSplineTrack: open tracks are not supported");
  }

  const cp = cps.map((p, i) => {
    if (!p || typeof p !== "object") {
      throw new Error(`parseSplineTrack: controlPoints[${i}] is not an object`);
    }
    return {
      x: +p.x || 0,
      y: +p.y || 0,
      z: +p.z || 0,
      bank: +p.bank || 0,
      hw: p.hw != null && +p.hw > 0 ? +p.hw : null,
    };
  });

  return {
    cp,
    halfWidth: data.halfWidth > 0 ? +data.halfWidth : 7,
    sampleSpace: data.sampleSpace > 0 ? +data.sampleSpace : 3.2,
    name: typeof data.name === "string" ? data.name : undefined,
    applyDefaultRamp: false,
  };
}

/**
 * Fetch a spline-track JSON URL and build the runtime track samples.
 * @param {string} url same-origin path (e.g. assets/3D/maps/test_track.json)
 */
export async function loadSplineTrack(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`loadSplineTrack: fetch failed ${res.status} for ${url}`);
  }
  const data = await res.json();
  const def = parseSplineTrack(data);
  return buildTrack(def);
}

/** Sync helper for Node smoke tests (no fetch). */
export function buildFromSplineData(data) {
  return buildTrack(parseSplineTrack(data));
}

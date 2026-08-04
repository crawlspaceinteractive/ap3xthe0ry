/**
 * engine/tunable.js — Local replacement for Star SDK tunable().
 *
 * Reads tuning overrides from the <script id="__star_tune"> JSON blob in
 * index.html. Falls back to the provided defaults when no override exists.
 * Returns a plain object — values are read fresh each frame, so live edits
 * to the JSON (or future DOM sliders) apply instantly.
 */

let _cache = null;

function _loadOverrides() {
  if (_cache !== null) return _cache;
  _cache = {};
  try {
    const el = document.getElementById("__star_tune");
    if (el) _cache = JSON.parse(el.textContent);
  } catch (_) { /* missing or malformed — use defaults */ }
  return _cache;
}

/**
 * @param {string} group   — tuning group name (e.g. "vehicle", "chasecam")
 * @param {object} defaults — default values
 * @param {object} [schemas] — optional slider schemas (ignored locally, kept for API compat)
 * @returns {object} merged tuning values
 */
export function tunable(group, defaults, schemas) {
  const overrides = _loadOverrides()[group] || {};
  return { ...defaults, ...overrides };
}

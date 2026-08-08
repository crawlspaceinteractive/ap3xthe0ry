/**
 * persistence.js — JSON save/load (shared Froyo + AP3X racer fields).
 *
 * Persisted via localStorage under "froyo.save". Single document for both
 * the legacy platformer and the racer (racer* keys). Autosave.js is the
 * racer-facing API over this store.
 */
const KEY = "froyo.save";

export const DEFAULT_SAVE = {
  // ---- Legacy Froyo --------------------------------------------------------
  sprinkles: 0,
  lives: 5,
  worldsCleared: 0,   // Phase 4.3 — highest world number completed (hub unlocks)
  unlocked_worlds: ["sundae_isles"],
  input_map: null, // null = use defaults
  fxVolume:  0.8,  // FX master gain (0–1)
  bgmVolume: 0.55, // BGM master gain (0–1)

  // ---- AP3X racer (autosave.js) --------------------------------------------
  racerSfxVol: 0.9,
  racerMusicVol: 0.8,
  selectedLevelIdx: 0,
  // Future: bestLaps: {}, unlocks: [], …
};

export function loadSave() {
  if (typeof localStorage === "undefined") return { ...DEFAULT_SAVE };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SAVE };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SAVE, ...parsed };
  } catch (_) {
    return { ...DEFAULT_SAVE };
  }
}

export function writeSave(data) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (_) { /* quota / disabled — silent */ }
}

export function exportFroyoBlob(data) {
  const json = JSON.stringify(data, null, 2);
  return new Blob([json], { type: "application/json" });
}

/**
 * Trigger a download of the current save as a .froyo file.
 */
export function downloadFroyoFile(data, filename = "save.froyo") {
  if (typeof document === "undefined") return;
  const blob = exportFroyoBlob(data);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

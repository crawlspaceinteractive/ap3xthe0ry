/**
 * data/autosave.js — Racer-facing persistence for settings and progress.
 *
 * Single store: reads/writes racer* fields on the shared persistence.js
 * document (`froyo.save`). Triggered by:
 *   - Boot (load + applySnapshot)
 *   - Leaving OPTIONS / PAUSE
 *   - Confirming a course (PLAY)
 */
import { loadSave, writeSave, DEFAULT_SAVE } from "./persistence.js";

export const DEFAULT_AUTOSAVE = {
  racerSfxVol: DEFAULT_SAVE.racerSfxVol,
  racerMusicVol: DEFAULT_SAVE.racerMusicVol,
  selectedLevelIdx: DEFAULT_SAVE.selectedLevelIdx,
};

/** Pull the racer snapshot out of the shared save document. */
export function loadAutosave() {
  const save = loadSave();
  return {
    racerSfxVol: save.racerSfxVol,
    racerMusicVol: save.racerMusicVol,
    selectedLevelIdx: save.selectedLevelIdx | 0,
  };
}

/** Merge a racer snapshot into the shared save and write it. */
export function saveAutosave(snapshot) {
  const save = loadSave();
  if (snapshot.racerSfxVol != null) save.racerSfxVol = snapshot.racerSfxVol;
  if (snapshot.racerMusicVol != null) save.racerMusicVol = snapshot.racerMusicVol;
  if (snapshot.selectedLevelIdx != null) save.selectedLevelIdx = snapshot.selectedLevelIdx | 0;
  writeSave(save);
}

/** Snapshot current volumes + selected course from live game objects. */
export function captureSnapshot(racerSound, racerGame) {
  const vols = racerSound ? racerSound.getVolumes() : { sfx: DEFAULT_AUTOSAVE.racerSfxVol, music: DEFAULT_AUTOSAVE.racerMusicVol };
  const levelIdx = racerGame
    ? ((racerGame.menu && racerGame.menu.selectedLevelIdx != null)
        ? racerGame.menu.selectedLevelIdx
        : racerGame.levelIdx) | 0
    : 0;
  return {
    racerSfxVol: vols.sfx,
    racerMusicVol: vols.music,
    selectedLevelIdx: levelIdx,
  };
}

/** Apply volumes from a snapshot onto racerSound. */
export function applySnapshot(snapshot, racerSound) {
  if (!racerSound || !snapshot) return;
  if (snapshot.racerSfxVol != null) racerSound.setSfxVol(snapshot.racerSfxVol);
  if (snapshot.racerMusicVol != null) racerSound.setMusicVol(snapshot.racerMusicVol);
}

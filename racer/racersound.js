/**
 * racer/racersound.js — All audio for the racer, via the Star Audio SDK.
 *
 *  - Background music: shuffled playlist of the 22 uploaded tracks,
 *    lazy-loaded one at a time, auto-advances when a track ends.
 *  - SFX:
 *      engine   — file-based loop, pitch follows speed / boost
 *      screech  — file-based loop while drifting, volume follows speed
 *      crash    — file-based one-shot on wall impacts
 *      crunch   — file-based one-shot landing thud
 *      boost    — file-based one-shot rising whoosh
 *      tierup   — file-based blip on drift charge tier crossing
 *
 * Volume plumbing:
 *   _sfxVol / _musicVol are local multipliers 0..1.
 *   Every per-frame loop volume and one-shot {volume} is scaled by _sfxVol.
 *   Music volume is applied via SDK setMusicVolume (persists automatically).
 */
import { audio } from "../engine/sdk-audio.js";
import { TUNE } from "./vehicle.js";

const MUSIC_TRACKS = [
  "assets/audio/soundtrack/1._collector.mp3",
  "assets/audio/soundtrack/2._hoarder.mp3",
  "assets/audio/soundtrack/3._ahura.mp3",
  "assets/audio/soundtrack/4._lost_triplet.mp3",
  "assets/audio/soundtrack/5._neon_static.mp3",
  "assets/audio/soundtrack/6._piston_pusher.mp3",
  "assets/audio/soundtrack/7._incline.mp3",
  "assets/audio/soundtrack/8._octane.mp3",
  "assets/audio/soundtrack/9._untitled.mp3",
  "assets/audio/soundtrack/10._hairpin.mp3",
  "assets/audio/soundtrack/11._liquid.mp3",
  "assets/audio/soundtrack/12._chrome_coil.mp3",
  "assets/audio/soundtrack/13._satin_fuse.mp3",
  "assets/audio/soundtrack/14._spline_force.mp3",
  "assets/audio/soundtrack/15._redline.mp3",
  "assets/audio/soundtrack/16._whitewall.mp3",
  "assets/audio/soundtrack/17._paper_boats.mp3",
  "assets/audio/soundtrack/18._acid_rain.mp3",
  "assets/audio/soundtrack/19._pavement.mp3",
  "assets/audio/soundtrack/20._rollcage.mp3",
  "assets/audio/soundtrack/21._close_shave.mp3",
  "assets/audio/soundtrack/22._u-turn.mp3",
];

// SFX definitions: file-based across the board.
const SFX = {
  engine: {
    src: "assets/audio/sounds/sfx_engine_loop.mp3",
    group: "sfx",
  },
  screech: {
    src: "assets/audio/sounds/sfx_screech_loop.mp3",
    group: "sfx",
  },
  crash: {
    src: "assets/audio/sounds/sfx_crash.mp3",
    group: "sfx",
  },
  crunch: {
    src: "assets/audio/sounds/sfx_crunch.mp3",
    group: "sfx",
  },
  boost: {
    src: "assets/audio/sounds/sfx_boost.mp3",
    group: "sfx",
  },
  tierup: {
    src: "assets/audio/sounds/sfx_tierup.mp3",
    group: "sfx",
  },
};

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Set playback rate on a live loop handle (SDK handle wraps a Howler sound). */
function setRate(handle, rate) {
  try {
    handle._howl.rate(rate, handle._soundId);
  } catch (_) { /* rate is best-effort */ }
}

/** Resume a loop handle that the SDK paused (e.g. tab was hidden). */
function ensurePlaying(handle) {
  try {
    if (!handle.playing) handle._howl.play(handle._soundId);
  } catch (_) { /* best-effort */ }
}

class RacerSound {
  constructor() {
    this._ready = audio.preload(SFX);
    this._started = false;

    // Loops
    this._engine = null;
    this._screech = null;
    this._engineRate = 0.6;
    this._screechVol = 0;

    // Volume multipliers (0..1). Every SFX volume is scaled by _sfxVol.
    this._sfxVol = 0.9;
    this._musicVol = 0.8;

    // Event edge-detection
    this._prevWallHitT = 0;
    this._prevLandT = 0;
    this._prevBoostT = 0;
    this._prevTier = -1;

    // Music playlist
    this._order = shuffle(MUSIC_TRACKS);
    this._trackIdx = -1;
    this._musicHandle = null;
    this._musicOn = false;
    this._advancing = false;
    this._stalledChecks = 0;

    // Watchdog: advance the playlist when the current track ends.
    setInterval(() => this._musicWatchdog(), 1500);
  }

  // ---- Volume API (called from pause-menu sliders) --------------------------
  getVolumes() {
    return { sfx: this._sfxVol, music: this._musicVol };
  }

  setSfxVol(v) {
    this._sfxVol = Math.max(0, Math.min(1, v));
  }

  setMusicVol(v) {
    this._musicVol = Math.max(0, Math.min(1, v));
    audio.setMusicVolume(this._musicVol);
  }

  /** Call once, on the first transition into RACE (i.e. after a user gesture). */
  async startRace() {
    if (!this._started) {
      this._started = true;
      await this._ready;
      this._engine = audio.play("engine", { loop: true, volume: 0 });
      this._screech = audio.play("screech", { loop: true, volume: 0 });
    }
    if (!this._musicOn) {
      this._musicOn = true;
      this._nextTrack();
    }
  }

  /** Per fixed step (60 Hz) while racing. */
  update(v, controls) {
    const sv = this._sfxVol;

    // --- Engine: pitch from speed, volume from throttle -----------------
    const spd = Math.min(1, Math.abs(v.speedF) / Math.max(0.01, TUNE.topSpeed));
    const boosting = v.boostT > 0;
    const targetRate = 0.55 + spd * 2.1 + (boosting ? 0.5 : 0);
    this._engineRate += (targetRate - this._engineRate) * 0.08; // smooth revs
    const targetVol = v.respawnT > 0
      ? 0
      : (0.10 + spd * 0.16 + (controls && controls.throttle ? 0.08 : 0) + (boosting ? 0.06 : 0)) * sv;
    if (this._engine) {
      ensurePlaying(this._engine);
      setRate(this._engine, this._engineRate);
      this._engine.setVolume(targetVol);
    }

    // --- Tire screech while drifting -------------------------------------
    const screeching = v.drifting && v.grounded && v.respawnT === 0;
    const screechTarget = screeching ? (0.10 + spd * 0.22) * sv : 0;
    this._screechVol += (screechTarget - this._screechVol) * 0.2;
    if (this._screech) {
      ensurePlaying(this._screech);
      setRate(this._screech, 0.9 + spd * 0.35 + (v.tier + 1) * 0.06);
      this._screech.setVolume(this._screechVol);
    }

    // --- One-shot events (edge-detected off vehicle timers) --------------
    if (v.wallHitT > this._prevWallHitT) {
      audio.play("crash", { volume: (0.35 + spd * 0.35) * sv });
    }
    if (v.landT > this._prevLandT) {
      audio.play("crunch", { volume: (0.25 + spd * 0.3) * sv });
    }
    if (v.boostT > this._prevBoostT + 1) {
      audio.play("boost", { volume: sv });
    }
    if (v.drifting && v.tier > this._prevTier && v.tier >= 0) {
      audio.play("tierup", { rate: 1 + v.tier * 0.2, volume: sv });
    }
    this._prevWallHitT = v.wallHitT;
    this._prevLandT = v.landT;
    this._prevBoostT = v.boostT;
    this._prevTier = v.drifting ? v.tier : -1;
  }

  /** Silence the loops instantly (pause menu / leaving RACE). */
  duck() {
    if (this._engine) this._engine.setVolume(0);
    if (this._screech) this._screech.setVolume(0);
    this._screechVol = 0;
  }

  // --- Music playlist ------------------------------------------------------
  async _nextTrack() {
    if (this._advancing || !this._musicOn) return;
    this._advancing = true;
    try {
      // Try tracks in shuffled order; skip any that fail to load.
      for (let attempts = 0; attempts < this._order.length; attempts++) {
        this._trackIdx = (this._trackIdx + 1) % this._order.length;
        if (this._trackIdx === 0) this._order = shuffle(this._order);
        const src = this._order[this._trackIdx];
        const id = "music." + src; // "music." prefix → SDK music volume group
        await audio.preload({ [id]: { src, group: "music" } });
        const h = audio.play(id, { loop: false });
        if (h) {
          this._musicHandle = h;
          this._stalledChecks = 0;
          return;
        }
      }
      this._musicHandle = null; // nothing loadable; watchdog will retry
    } finally {
      this._advancing = false;
    }
  }

  _musicWatchdog() {
    if (!this._musicOn || this._advancing || document.hidden) return;
    const h = this._musicHandle;
    if (!h || !h.playing) {
      // A couple of grace checks so slow starts aren't mistaken for track end.
      if (++this._stalledChecks >= 2) {
        this._stalledChecks = 0;
        this._nextTrack();
      }
    } else {
      this._stalledChecks = 0;
    }
  }
}

export const racerSound = new RacerSound();
